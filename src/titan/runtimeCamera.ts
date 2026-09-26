import { create } from 'zustand';

/**
 * The orbit yaw of the third-person camera, published so the DOM HUD can convert its WASD input into
 * a world-space direction (forward is always "away from the camera"). The HUD reads it with
 * `getState()` inside its input interval, so writing it every frame never re-renders anything.
 */
interface TitanCameraState { yaw: number }
// 0 is the camera pose a hero spawns into (every zone spawn faces -Z), so input is already correct
// on the very first frame — before the rig has run once.
export const useTitanCamera = create<TitanCameraState>(() => ({ yaw: 0 }));
export function setTitanCameraYaw(yaw: number) {
  if (Math.abs(useTitanCamera.getState().yaw - yaw) > 1e-4) useTitanCamera.setState({ yaw });
}
/** World-space move direction for a screen-relative input, relative to the live camera yaw. */
export function worldMoveDirection(forward: number, strafe: number): { x: number; z: number } {
  if (!forward && !strafe) return { x: 0, z: 0 };
  const yaw = useTitanCamera.getState().yaw;
  const sin = Math.sin(yaw); const cos = Math.cos(yaw);
  // Forward = from the camera toward the hero; right = that turned a quarter turn clockwise.
  const x = forward * -sin + strafe * cos;
  const z = forward * -cos + strafe * -sin;
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}
