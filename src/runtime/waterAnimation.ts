/** A smooth periodic clock for authored water studies. Keeping impact ages on the real clock
 * lets incidental splashes decay normally. Legacy water retains its advancing swell. */
export function waterAnimationTime(time: number, loopDuration?: number): number {
  if (!loopDuration || !Number.isFinite(loopDuration) || loopDuration <= 0) return time;
  const phase = (time % loopDuration) / loopDuration * Math.PI * 2;
  return Math.sin(phase) * loopDuration / (Math.PI * 2);
}
