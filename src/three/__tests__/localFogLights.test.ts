import { expect, it } from 'vitest';
import * as THREE from 'three';
import { LocalFogLights, localFogBudget } from '../localFogLights';
import { resolveVolumetric } from '../VolumetricFog';
import { qualityProfile } from '../quality';

it('keeps local fog opt-in, finite and within the quality budget', () => {
  expect(resolveVolumetric({ volumetricFogEnabled: true }, qualityProfile('High'))?.localStrength).toBe(0);
  expect(resolveVolumetric({ volumetricFogEnabled: true, volumetricLocalStrength: NaN }, qualityProfile('Epic'))?.localStrength).toBe(0);
  expect(resolveVolumetric({ volumetricFogEnabled: true, volumetricLocalStrength: 12 }, qualityProfile('Epic'))?.localStrength).toBe(4);
  expect(resolveVolumetric({ volumetricFogEnabled: true }, qualityProfile('Low'))).toBeNull();
  expect([0,12,28,40].map(localFogBudget)).toEqual([0,2,4,6]);
});

it('prioritizes influential local lights, rejects hidden parents and follows world-space motion', () => {
  const scene = new THREE.Scene(), camera = new THREE.Vector3(0, 2, 0), fog = new LocalFogLights();
  for (let i = 0; i < 9; i++) { const light = new THREE.PointLight('#ff0000', 5, 10); light.position.set(i * 4, 2, 0); scene.add(light); }
  const parent = new THREE.Group(), spot = new THREE.SpotLight('#00aaff', 90, 20, .4, .5);
  parent.position.set(1, 0, 0); spot.position.set(0, 3, 0); spot.target.position.set(0, 0, -1); parent.add(spot, spot.target); scene.add(parent);
  fog.update(scene, camera, 4); expect(fog.count).toBe(4); expect(fog.positions[0].x).toBe(1);
  expect(fog.directions[0].y).toBeLessThan(-.9); expect(fog.cones[0].x).toBeCloseTo(Math.cos(.4));
  parent.position.x = 2; fog.update(scene, camera, 4); expect(fog.positions[0].x).toBe(2);
  parent.visible = false; fog.update(scene, camera, 4); expect(fog.positions.slice(0, fog.count).every(p => p.y === 2)).toBe(true);
  fog.update(scene, camera, 100); expect(fog.count).toBe(6);
});

it('orients rectangular fog lights along their real emitting face', () => {
  const scene = new THREE.Scene(), fog = new LocalFogLights(), light = new THREE.RectAreaLight('#ffffff', 10, 4, 2);
  light.rotation.y = Math.PI / 2; scene.add(light); fog.update(scene, new THREE.Vector3(), 2);
  expect(fog.directions[0].x).toBeCloseTo(-1); expect(fog.directions[0].w).toBe(1);
  expect(fog.colors[0].x).toBeCloseTo(52); expect(fog.cones[0].x).toBe(0);
});


it('turns an already-present hidden light on at the exact cinematic cue', () => {
  const scene = new THREE.Scene(), fog = new LocalFogLights(), parent = new THREE.Group();
  const light = new THREE.PointLight('#ffffff', 30, 10); parent.add(light); scene.add(parent); parent.visible = false;
  fog.update(scene, new THREE.Vector3(), 2); expect(fog.count).toBe(0);
  parent.visible = true;
  fog.update(scene, new THREE.Vector3(), 2); expect(fog.count).toBe(1);
  light.visible = false;
  fog.update(scene, new THREE.Vector3(), 2); expect(fog.count).toBe(0);
});
