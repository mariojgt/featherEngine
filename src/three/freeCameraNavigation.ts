import * as THREE from 'three';

/** Shared Unreal-style viewport navigation used by both editor framing and Playtime Camera Record. */
export type FreeCameraMode = 'none' | 'fly' | 'orbit' | 'pan';

export interface FreeCameraNavigationState {
  yaw: number;
  pitch: number;
  distance: number;
  target: THREE.Vector3;
  mode: FreeCameraMode;
  keys: Set<string>;
  flySpeed: number;
  euler: THREE.Euler;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  move: THREE.Vector3;
  delta: THREE.Vector3;
}

export const FREE_CAMERA_DEFAULT_SPEED = 8;
export const FREE_CAMERA_MIN_SPEED = 0.5;
export const FREE_CAMERA_MAX_SPEED = 240;
export const FREE_CAMERA_BOOST = 3;
export const FREE_CAMERA_LOOK_SENSITIVITY = 0.0026;
export const FREE_CAMERA_ORBIT_SENSITIVITY = 0.006;
export const FREE_CAMERA_PAN_SENSITIVITY = 0.0016;
export const FREE_CAMERA_MAX_DELTA = 0.05;
export const FREE_CAMERA_MIN_DISTANCE = 0.5;
export const FREE_CAMERA_MAX_DISTANCE = 600;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2 - 0.01;

export const clampFreeCamera = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const createFreeCameraNavigationState = (): FreeCameraNavigationState => ({
  yaw: 0,
  pitch: 0,
  distance: 10,
  target: new THREE.Vector3(0, 0.5, 0),
  mode: 'none',
  keys: new Set<string>(),
  flySpeed: FREE_CAMERA_DEFAULT_SPEED,
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  move: new THREE.Vector3(),
  delta: new THREE.Vector3(),
});

/** Seed yaw/pitch and the real authored look target without replacing it with an arbitrary distance. */
export function seedFreeCameraNavigation(
  state: FreeCameraNavigationState,
  camera: THREE.Camera,
  target: THREE.Vector3,
  minimumDistance = 0.0001,
) {
  state.target.copy(target);
  state.distance = Math.max(camera.position.distanceTo(state.target), minimumDistance);
  camera.lookAt(state.target);
  state.euler.setFromQuaternion(camera.quaternion, 'YXZ');
  state.yaw = state.euler.y;
  state.pitch = state.euler.x;
}

export function orientFreeCamera(state: FreeCameraNavigationState, camera: THREE.Camera) {
  state.euler.set(state.pitch, state.yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(state.euler);
}

export function applyFreeCameraFromTarget(state: FreeCameraNavigationState, camera: THREE.Camera) {
  orientFreeCamera(state, camera);
  state.forward.set(0, 0, -1).applyEuler(state.euler);
  camera.position.copy(state.target).addScaledVector(state.forward, -state.distance);
}

export function applyFreeCameraFromPosition(state: FreeCameraNavigationState, camera: THREE.Camera) {
  orientFreeCamera(state, camera);
  state.forward.set(0, 0, -1).applyEuler(state.euler);
  state.target.copy(camera.position).addScaledVector(state.forward, state.distance);
}

/** RMB free-look, matching the editor's sensitivity and horizontal direction exactly. */
export function lookFreeCamera(state: FreeCameraNavigationState, camera: THREE.Camera, dx: number, dy: number) {
  state.yaw -= dx * FREE_CAMERA_LOOK_SENSITIVITY;
  state.pitch = clampFreeCamera(state.pitch - dy * FREE_CAMERA_LOOK_SENSITIVITY, -HALF_PI, HALF_PI);
  applyFreeCameraFromPosition(state, camera);
}

/** Alt+LMB orbit around the current target. */
export function orbitFreeCamera(state: FreeCameraNavigationState, camera: THREE.Camera, dx: number, dy: number) {
  state.yaw -= dx * FREE_CAMERA_ORBIT_SENSITIVITY;
  state.pitch = clampFreeCamera(state.pitch - dy * FREE_CAMERA_ORBIT_SENSITIVITY, -HALF_PI, HALF_PI);
  applyFreeCameraFromTarget(state, camera);
}

/** MMB pan in the current screen plane. */
export function panFreeCamera(state: FreeCameraNavigationState, camera: THREE.Camera, dx: number, dy: number) {
  orientFreeCamera(state, camera);
  state.forward.set(0, 0, -1).applyEuler(state.euler);
  state.right.crossVectors(state.forward, WORLD_UP).normalize();
  state.up.crossVectors(state.right, state.forward).normalize();
  const scale = Math.max(state.distance, 1) * FREE_CAMERA_PAN_SENSITIVITY;
  state.delta.set(0, 0, 0).addScaledVector(state.right, -dx * scale).addScaledVector(state.up, dy * scale);
  camera.position.add(state.delta);
  state.target.add(state.delta);
}

/** RMB+wheel changes fly speed; an ordinary wheel dollies around the current target. */
export function wheelFreeCamera(state: FreeCameraNavigationState, camera: THREE.Camera, deltaY: number) {
  if (state.mode === 'fly') {
    state.flySpeed = clampFreeCamera(
      state.flySpeed * (deltaY < 0 ? 1.15 : 0.87),
      FREE_CAMERA_MIN_SPEED,
      FREE_CAMERA_MAX_SPEED,
    );
    return;
  }
  state.distance = clampFreeCamera(
    state.distance * (deltaY < 0 ? 0.86 : 1.16),
    FREE_CAMERA_MIN_DISTANCE,
    FREE_CAMERA_MAX_DISTANCE,
  );
  applyFreeCameraFromTarget(state, camera);
}

/** Apply one editor-style fly step. Keyboard movement is deliberately inactive unless RMB is held. */
export function stepFreeCameraNavigation(
  state: FreeCameraNavigationState,
  camera: THREE.Camera,
  delta: number,
): boolean {
  if (state.mode !== 'fly' || state.keys.size === 0) return false;
  const dt = Math.min(delta, FREE_CAMERA_MAX_DELTA);
  state.euler.set(state.pitch, state.yaw, 0, 'YXZ');
  state.forward.set(0, 0, -1).applyEuler(state.euler);
  state.right.crossVectors(state.forward, WORLD_UP).normalize();
  state.move.set(0, 0, 0);
  const keys = state.keys;
  if (keys.has('w')) state.move.add(state.forward);
  if (keys.has('s')) state.move.sub(state.forward);
  if (keys.has('d')) state.move.add(state.right);
  if (keys.has('a')) state.move.sub(state.right);
  if (keys.has('e')) state.move.add(WORLD_UP);
  if (keys.has('q')) state.move.sub(WORLD_UP);
  if (state.move.lengthSq() === 0) return false;
  const speed = state.flySpeed * (keys.has('shift') ? FREE_CAMERA_BOOST : 1) * dt;
  state.move.normalize().multiplyScalar(speed);
  camera.position.add(state.move);
  state.target.add(state.move);
  return true;
}
