/**
 * Smoothed simulation clock.
 *
 * Raw requestAnimationFrame deltas jitter (15.4 / 17.9 / 16.2ms even on a locked 60Hz display) and
 * SPIKE on any hitch — GC, a shader compile, a heavy spawn. Feeding them straight into the simulation
 * is what makes a moving car/character "freeze then snap": nothing renders during the spike, then ONE
 * tick integrates the whole backlog and the object teleports forward. The jitter alone reads as a
 * subtle rubbing/"weird friction" at speed, because per-frame motion keeps changing size while the
 * display refreshes uniformly.
 *
 * smoothFrameDelta() clamps each delta to a band around the recent frame cadence (a slow EMA), so:
 *  - frame-to-frame RAF jitter is evened out → steady motion at any refresh rate (60/120/144Hz,
 *    adaptive sync included — the EMA tracks whatever cadence the browser actually delivers);
 *  - a spike contributes at most ~1.4× a normal step; most of its backlog is deliberately DROPPED
 *    (a few milliseconds of game time lost) rather than integrated — trading invisible wall-clock
 *    drift for the very visible teleport.
 *
 * Sustained slowdowns are still honored: if every frame genuinely takes 33ms, the EMA climbs there
 * within ~20 frames and the simulation runs full 33ms steps again (no permanent slow motion).
 */

const REST = 1 / 60;
let average = REST;

export function smoothFrameDelta(rawSeconds: number): number {
  // A tab switch / debugger pause isn't motion — restart the cadence estimate instead of "catching up".
  if (rawSeconds > 0.25 || rawSeconds <= 0) {
    average = REST;
    return REST;
  }
  // Track the recent cadence with a slow EMA; clamp the sample so a single spike can't yank it up.
  average += (Math.min(rawSeconds, average * 2) - average) * 0.08;
  // One simulation step may deviate at most -40%/+40% from the recent cadence.
  return Math.min(0.05, Math.max(average * 0.6, Math.min(average * 1.4, rawSeconds)));
}

/** Call when Play starts so the first frames of a session aren't shaped by the previous one. */
export function resetFrameClock(): void {
  average = REST;
}
