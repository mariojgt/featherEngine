export interface ClothClock { time?: number; remainder: number; }
export const CLOTH_STEP = 1 / 60;

/** Bound catch-up after a long stall, retain fractional steps, and never advance a paused clock. */
export function consumeClothSteps(clock: ClothClock, time: number): number {
  if (!Number.isFinite(time)) return 0;
  if (clock.time === undefined || time < clock.time) {
    clock.time = time; clock.remainder = 0; return 0;
  }
  clock.remainder += Math.min(0.2, time - clock.time);
  clock.time = time;
  const steps = Math.min(12, Math.floor((clock.remainder + 1e-9) / CLOTH_STEP));
  clock.remainder = Math.max(0, clock.remainder - steps * CLOTH_STEP);
  return steps;
}
