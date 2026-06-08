// A tiny one-frame-ish bus for explosion blasts, so simulations that AREN'T Rapier rigid bodies (cloth,
// and later anything else) can react to the same blast the rigid-body world gets. The explosion pass
// pushes a blast; each consumer (e.g. every ClothSim) processes blasts newer than the last id it saw, so
// one blast reaches all consumers exactly once. Bounded ring — old blasts are dropped.

import type { Vector3Tuple } from '../types';

export interface Blast {
  id: number;
  center: Vector3Tuple;
  radius: number;
  strength: number;
}

let seq = 0;
const blasts: Blast[] = [];
const MAX = 32;

/** Record a blast (called by the explosion pass alongside the rigid-body radial impulse). */
export function pushExplosion(center: Vector3Tuple, radius: number, strength: number): void {
  blasts.push({ id: ++seq, center: [center[0], center[1], center[2]], radius, strength });
  if (blasts.length > MAX) blasts.shift();
}

/** Blasts recorded after `lastId` (a consumer passes the highest id it already handled). */
export function blastsSince(lastId: number): Blast[] {
  if (!blasts.length || blasts[blasts.length - 1].id <= lastId) return [];
  return blasts.filter((b) => b.id > lastId);
}

/** The newest blast id (a consumer stores this after processing, so it won't re-apply old blasts). */
export function latestBlastId(): number {
  return seq;
}

/** Reset on Stop so a fresh Play doesn't replay last session's blasts. */
export function clearExplosions(): void {
  blasts.length = 0;
  seq = 0;
}
