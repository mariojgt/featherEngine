/**
 * Persistent tire skid marks: rubber laid on the track by braking, drifting and offroad wheels.
 * The runtime tick pushes mark segments per wheel contact; the SkidMarks renderer (mounted in the
 * editor viewport and the exported player) draws them as flat quads that linger and fade.
 *
 * A plain module singleton (like `mouseLook` / `execTrace`) so per-frame producers never touch the
 * Zustand store. A fixed ring buffer caps the cost: old marks get overwritten by new ones.
 */
export interface SkidSegment {
  x: number;
  y: number;
  z: number;
  /** Travel heading (radians) — the quad is aligned along it so a slide lays angled rubber. */
  yaw: number;
  /** 0..1 — how hard the tire was working (alpha/width of the mark). */
  strength: number;
  /** Seconds of visible life remaining (the renderer decrements and fades the tail end). */
  life: number;
}

export const SKID_MARK_LIFE = 14;
export const MAX_SKID_SEGMENTS = 1024;

/** Ring buffer of segments + a monotonically increasing write head (head % MAX = next slot). */
export const skidMarks = {
  segments: [] as SkidSegment[],
  head: 0,
};

/** Per-wheel last laid position, so marks are spaced by distance travelled, not by frame rate. */
const lastByKey = new Map<string, [number, number]>();
const MIN_SPACING = 0.42;

export function addSkidMark(key: string, x: number, y: number, z: number, yaw: number, strength: number) {
  const last = lastByKey.get(key);
  if (last) {
    const dx = x - last[0];
    const dz = z - last[1];
    if (dx * dx + dz * dz < MIN_SPACING * MIN_SPACING) return;
  }
  lastByKey.set(key, [x, z]);
  const segment: SkidSegment = { x, y, z, yaw, strength: Math.min(1, Math.max(0.1, strength)), life: SKID_MARK_LIFE };
  const slot = skidMarks.head % MAX_SKID_SEGMENTS;
  if (skidMarks.segments.length <= slot) skidMarks.segments.push(segment);
  else skidMarks.segments[slot] = segment;
  skidMarks.head += 1;
}

export function clearSkidMarks() {
  skidMarks.segments.length = 0;
  skidMarks.head = 0;
  lastByKey.clear();
}
