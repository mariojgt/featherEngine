import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FREE_CAMERA_DEFAULT_SPEED,
  createFreeCameraNavigationState,
  lookFreeCamera,
  seedFreeCameraNavigation,
  stepFreeCameraNavigation,
  wheelFreeCamera,
} from '../freeCameraNavigation';

function createRig() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 1_000);
  camera.position.set(0, 2, 6);
  const navigation = createFreeCameraNavigationState();
  seedFreeCameraNavigation(navigation, camera, new THREE.Vector3(0, 2, 0));
  return { camera, navigation };
}

describe('shared editor-style free camera navigation', () => {
  it('flies forward only while RMB fly mode is active', () => {
    const { camera, navigation } = createRig();
    navigation.keys.add('w');

    expect(stepFreeCameraNavigation(navigation, camera, 0.05)).toBe(false);
    expect(camera.position.z).toBeCloseTo(6);

    navigation.mode = 'fly';
    expect(stepFreeCameraNavigation(navigation, camera, 0.05)).toBe(true);
    expect(camera.position.z).toBeCloseTo(6 - FREE_CAMERA_DEFAULT_SPEED * 0.05);
    expect(navigation.target.z).toBeCloseTo(-FREE_CAMERA_DEFAULT_SPEED * 0.05);
  });

  it('uses editor directions for strafe-right and vertical movement', () => {
    const { camera, navigation } = createRig();
    navigation.mode = 'fly';
    navigation.keys.add('d');
    stepFreeCameraNavigation(navigation, camera, 0.05);
    expect(camera.position.x).toBeGreaterThan(0);

    navigation.keys.clear();
    navigation.keys.add('e');
    const previousY = camera.position.y;
    stepFreeCameraNavigation(navigation, camera, 0.05);
    expect(camera.position.y).toBeGreaterThan(previousY);
  });

  it('turns right on a rightward RMB drag and preserves the authored target distance', () => {
    const { camera, navigation } = createRig();
    const distance = navigation.distance;
    lookFreeCamera(navigation, camera, 100, 0);

    expect(navigation.target.x).toBeGreaterThan(camera.position.x);
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(distance);
  });

  it('uses the wheel for dolly normally and fly-speed adjustment while RMB is held', () => {
    const { camera, navigation } = createRig();
    const distance = navigation.distance;
    wheelFreeCamera(navigation, camera, -1);
    expect(navigation.distance).toBeLessThan(distance);

    navigation.mode = 'fly';
    const position = camera.position.clone();
    const speed = navigation.flySpeed;
    wheelFreeCamera(navigation, camera, -1);
    expect(navigation.flySpeed).toBeGreaterThan(speed);
    expect(camera.position.equals(position)).toBe(true);
  });
});
