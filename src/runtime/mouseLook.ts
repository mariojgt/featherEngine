/**
 * Accumulated mouse-look deltas for the active character's follow camera, shared between the
 * render layer (FollowCamera reads it each frame) and the store's runtime tick (camera-relative
 * movement rotates input by the camera yaw). Kept as a plain module singleton — like the drag
 * holder — so high-frequency mousemove events don't churn the Zustand store every frame.
 *
 * `dx`/`dy` are raw pixel sums since pointer-lock began; consumers multiply by the character's
 * `mouseSensitivity` to get yaw/pitch in radians.
 */
export const mouseLook = { dx: 0, dy: 0 };

export function resetMouseLook() {
  mouseLook.dx = 0;
  mouseLook.dy = 0;
}

/** Camera yaw (radians) for a given sensitivity — moving the mouse right turns the view right. */
export function cameraYaw(sensitivity: number): number {
  return -mouseLook.dx * sensitivity;
}

/** Camera pitch (radians) clamped to the character's limits — moving the mouse up looks up. */
export function cameraPitch(base: number, sensitivity: number, min: number, max: number): number {
  return Math.min(Math.max(base - mouseLook.dy * sensitivity, min), max);
}
