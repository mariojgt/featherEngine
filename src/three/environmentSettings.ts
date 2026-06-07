import * as THREE from 'three';
import type { SceneEnvironmentSettings, Vector3Tuple } from '../types';

export const defaultSceneEnvironment = (): SceneEnvironmentSettings => ({
  skyMode: 'procedural',
  backgroundColor: '#0F1117',
  skyTopColor: '#4F83FF',
  skyHorizonColor: '#F0B56A',
  skyGroundColor: '#121926',
  skyTextureAssetId: undefined,
  environmentMapAssetId: undefined,
  skyRotation: 0,
  environmentIntensity: 1,
  sunColor: '#FFE1A3',
  sunIntensity: 1.15,
  sunAzimuth: 38,
  sunElevation: 34,
  fogEnabled: true,
  fogColor: '#101623',
  fogNear: 16,
  fogFar: 44,
  volumetricFogEnabled: false,
  volumetricFogDensity: 0.1,
  volumetricFogColor: '#cfd8e8',
  volumetricFogHeight: 0,
  volumetricFogFalloff: 0.03,
  volumetricScattering: 0.6,
  volumetricSunStrength: 1.6,
  volumetricMaxDistance: 140,
});

export function withSceneEnvironmentDefaults(
  environment?: Partial<SceneEnvironmentSettings>,
): SceneEnvironmentSettings {
  return { ...defaultSceneEnvironment(), ...(environment ?? {}) };
}

export function sunDirectionFromEnvironment(environment: SceneEnvironmentSettings): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(environment.sunAzimuth);
  const elevation = THREE.MathUtils.degToRad(environment.sunElevation);
  const radius = Math.cos(elevation);
  return new THREE.Vector3(Math.sin(azimuth) * radius, Math.sin(elevation), Math.cos(azimuth) * radius).normalize();
}

export function sunPositionFromEnvironment(
  environment: SceneEnvironmentSettings,
  distance = 18,
): Vector3Tuple {
  const direction = sunDirectionFromEnvironment(environment);
  return [direction.x * distance, direction.y * distance, direction.z * distance];
}
