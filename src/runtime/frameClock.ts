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
// Game time the clamp denied (positive = the sim is behind the wall clock). Instead of DROPPING a
// spike's backlog outright — which freezes game time for the spike and reads as a "freeze then snap"
// at speed — we bank it and replay it a sliver per frame. Caps keep a giant stall from turning into
// a long fast-forward: at worst the sim runs ~15% fast for a handful of frames, which is invisible,
// while the old behavior lost the time forever (visible hesitation on every GC/compile hitch).
let backlog = 0;

export function smoothFrameDelta(rawSeconds: number): number {
  // A tab switch / debugger pause isn't motion — restart the cadence estimate instead of "catching up".
  if (rawSeconds > 0.25 || rawSeconds <= 0) {
    average = REST;
    backlog = 0;
    return REST;
  }
  // Track the recent cadence with a slow EMA; clamp the sample so a single spike can't yank it up.
  average += (Math.min(rawSeconds, average * 2) - average) * 0.08;
  // One simulation step may deviate at most -40%/+40% from the recent cadence.
  const base = Math.min(0.05, Math.max(average * 0.6, Math.min(average * 1.4, rawSeconds)));
  // Bank what the clamp denied (or granted early, when a short frame got clamped UP — negative drift),
  // then drain at most 15% of a frame per step so the catch-up itself can never look like a teleport.
  // Steady-state frames sit inside the clamp band (base === raw, drift 0) — behavior unchanged there.
  backlog = Math.min(0.08, Math.max(-0.05, backlog + (rawSeconds - base)));
  const release = backlog >= 0 ? Math.min(backlog, average * 0.15) : Math.max(backlog, -average * 0.15);
  backlog -= release;
  return Math.min(0.05, base + release);
}

/** Call when Play starts so the first frames of a session aren't shaped by the previous one. */
export function resetFrameClock(): void {
  average = REST;
  backlog = 0;
}
