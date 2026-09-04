/**
 * Root motion transport.
 *
 * Root motion means taking the displacement the ANIMATION applies to a character's root bone and
 * using it to drive the character, instead of moving the character at a speed picked in code. The
 * payoff is that the feet travel exactly as far as the animator authored, so a walk cycle cannot
 * slide.
 *
 * The awkward part is that the two halves live in different loops. The pose is produced in the render
 * loop (the mixer, inside SkinnedModel), and movement is applied in the runtime tick. This is a plain
 * module singleton bridging them, exactly like ragdollState and boneRegistry, so neither side has to
 * route per-frame data through Zustand.
 *
 * The renderer ACCUMULATES and the tick DRAINS, rather than the renderer publishing a velocity. The
 * two loops run at unrelated rates: several render frames may land between ticks, or none at all.
 * Summing distance alongside the animation time it covers, then dividing on drain, yields the correct
 * average speed for the interval whatever the ratio happens to be — and draining guarantees each
 * frame's displacement is consumed exactly once.
 */

/** Root displacement accumulated since the last drain. */
export interface RootMotionSample {
  /** Horizontal distance the root bone travelled, in world units. Vertical is ignored: gravity and
   *  jumping own the Y axis, and letting a clip fight them destabilises the character. */
  distance: number;
  /** Seconds of animation the distance covers. */
  elapsed: number;
}

const accumulated = new Map<string, RootMotionSample>();

/**
 * Adds one frame of root displacement. Called from the render loop after the mixer has posed the
 * skeleton. Non-finite input is dropped rather than poisoning the accumulator — a NaN here would
 * become a NaN character position, which is unrecoverable.
 */
export function accumulateRootMotion(objectId: string, distance: number, elapsed: number): void {
  if (!Number.isFinite(distance) || !Number.isFinite(elapsed) || elapsed <= 0) return;
  const existing = accumulated.get(objectId);
  if (existing) {
    existing.distance += distance;
    existing.elapsed += elapsed;
  } else {
    accumulated.set(objectId, { distance, elapsed });
  }
}

/**
 * Takes and clears the accumulated displacement for one object. Called from the runtime tick.
 *
 * Returns undefined when nothing has accumulated, which the caller must treat as "no root motion this
 * tick" and NOT as "speed zero" — a tick with no render frame in between would otherwise stop the
 * character dead.
 */
export function drainRootMotion(objectId: string): RootMotionSample | undefined {
  const sample = accumulated.get(objectId);
  if (!sample) return undefined;
  accumulated.delete(objectId);
  return sample;
}

/** Peeks without draining, for read-only consumers such as the debug readout. */
export function peekRootMotion(objectId: string): RootMotionSample | undefined {
  const sample = accumulated.get(objectId);
  return sample ? { ...sample } : undefined;
}

/**
 * Average speed the sample represents, in world units per second.
 *
 * Guarded to 0 for a degenerate interval: a NaN or Infinity reaching the character controller's
 * target velocity would put the transform beyond recovery.
 */
export function rootMotionSpeed(sample: RootMotionSample | undefined): number {
  if (!sample || !(sample.elapsed > 0)) return 0;
  const speed = sample.distance / sample.elapsed;
  return Number.isFinite(speed) ? Math.max(0, speed) : 0;
}

/** Clears every accumulator. Called when Play stops, so a new session starts clean. */
export function clearRootMotion(): void {
  accumulated.clear();
}

/**
 * Largest believable root speed, in world units per second.
 *
 * Used to reject the discontinuity when a looping clip wraps: the root jumps from the end of the cycle
 * back to the start, which reads as one enormous backwards step. A whole walk cycle's travel in a
 * single frame is hundreds of units per second, while a sprint is under ten, so the two are nowhere
 * near each other and a fixed ceiling separates them cleanly.
 */
export const MAX_ROOT_MOTION_SPEED = 25;

/**
 * Whether a frame's root displacement is plausible, or a loop wrap to be ignored.
 *
 * Also rejects backwards travel. A root track is authored moving forward along its own axis, so a
 * negative distance means the clip wrapped or the track is malformed; either way feeding it to the
 * controller would yank the character backwards.
 */
export function isPlausibleRootStep(distance: number, dt: number): boolean {
  if (!Number.isFinite(distance) || !Number.isFinite(dt) || dt <= 0) return false;
  if (distance < 0) return false;
  return distance / dt <= MAX_ROOT_MOTION_SPEED;
}
