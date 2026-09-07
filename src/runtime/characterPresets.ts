import type { CharacterControllerComponent } from '../types';

/** Movement presets change feel only; input ownership, cameras, rigs, and key bindings survive. */
export const CHARACTER_MOVEMENT_PRESETS = [
  { id: 'forgiving-platformer', name: 'Forgiving platformer', description: 'Quick starts, air steering, and a generous jump grace window.', patch: {
    stableJumpArc: true, moveSpeed: 5, sprintMultiplier: 1.6, jumpStrength: 8, gravity: 20, acceleration: 65, deceleration: 80,
    airControl: 0.65, fallMultiplier: 1.8, jumpCutMultiplier: 0.45, coyoteTime: 0.15, jumpBufferTime: 0.16,
    landingRecovery: 0.1, apexHang: 0.7, stepHeight: 0.3, stepMinWidth: 0.2, groundSnap: 0.3,
    maxSlopeDegrees: 45, slideSlopeDegrees: 50,
  } },
  { id: 'grounded-adventure', name: 'Grounded adventure', description: 'Measured acceleration, lower jumps, and less steering in the air.', patch: {
    stableJumpArc: true, moveSpeed: 4, sprintMultiplier: 1.7, jumpStrength: 6, gravity: 20, acceleration: 30, deceleration: 40,
    airControl: 0.25, fallMultiplier: 1.9, jumpCutMultiplier: 0.5, coyoteTime: 0.1, jumpBufferTime: 0.12,
    landingRecovery: 0.4, apexHang: 0.9, stepHeight: 0.25, stepMinWidth: 0.2, groundSnap: 0.3,
    maxSlopeDegrees: 40, slideSlopeDegrees: 45,
  } },
] satisfies Array<{ id: string; name: string; description: string; patch: Partial<CharacterControllerComponent> }>;

const finite = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
export function characterGroundSettings(character?: Partial<CharacterControllerComponent>) {
  return {
    stepHeight: finite(character?.stepHeight, 0.4, 0, 2),
    stepMinWidth: finite(character?.stepMinWidth, 0.2, 0.01, 2),
    groundSnap: finite(character?.groundSnap, 0.4, 0, 2),
    maxSlopeDegrees: character?.maxSlopeDegrees === undefined ? undefined : finite(character.maxSlopeDegrees, 45, 0, 89),
    slideSlopeDegrees: character?.slideSlopeDegrees === undefined ? undefined : finite(character.slideSlopeDegrees, 45, 0, 89),
  };
}
