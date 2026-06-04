/**
 * Throttled AI perception cache.
 *
 * `ai.hasLineOfSight` casts a physics ray from an enemy to the player. Evaluated naively that's one
 * raycast PER enemy PER frame (60 Hz) — the dominant cost in busy combat scenes, and pure waste:
 * perception doesn't need to update every 16 ms. We refresh each object's line-of-sight result at
 * most once every `LOS_REFRESH_FRAMES` ticks (~20 Hz) and serve the cached boolean in between, so a
 * scene with N enemies does ~N/3 raycasts per frame instead of N. The staleness window is ≤50 ms —
 * far below human reaction time, so an enemy ducking behind cover still "loses sight" effectively
 * instantly. The cache also collapses repeat evaluations of the same node within a single frame.
 *
 * Lifecycle: a module singleton (same pattern as transformBuffer/ragdolls). `beginPerceptionFrame`
 * is called once at the top of each `tickRuntime`; `clearPerception` is called on Play start/stop so
 * a fresh session never serves a stale result from the previous one.
 */

/** How many ticks a cached line-of-sight result stays valid. 3 ≈ 20 Hz at a 60 fps tick. */
const LOS_REFRESH_FRAMES = 3;

let frame = 0;
const losCache = new Map<string, { frame: number; value: boolean }>();

/** Advance the perception clock. Call once per tick before any LoS evaluation. */
export function beginPerceptionFrame(): void {
  frame += 1;
}

/** Wipe all cached perception (on Play start/stop) so sessions don't leak results into each other. */
export function clearPerception(): void {
  frame = 0;
  losCache.clear();
}

/**
 * Cached line-of-sight result for `id`, or `undefined` if there's no fresh entry and the caller must
 * cast a ray and report the answer back via {@link storeLineOfSight}.
 */
export function cachedLineOfSight(id: string): boolean | undefined {
  const entry = losCache.get(id);
  if (entry && frame - entry.frame < LOS_REFRESH_FRAMES) return entry.value;
  return undefined;
}

/** Record a freshly-computed line-of-sight result for `id` so the next few ticks can reuse it. */
export function storeLineOfSight(id: string, value: boolean): void {
  losCache.set(id, { frame, value });
}
