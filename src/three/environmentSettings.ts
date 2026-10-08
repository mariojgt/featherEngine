import * as THREE from 'three';
import type { SceneEnvironmentSettings, Vector3Tuple } from '../types';
import type { QualityProfile } from './quality';

/** Resolved environments share this gate with the post pass and the distance-fog fallback. */
export function isVolumetricFogActive(environment: SceneEnvironmentSettings, profile: QualityProfile): boolean {
  const density = environment.volumetricFogDensity;
  return profile.volumetricFog && Boolean(environment.volumetricFogEnabled)
    && Number.isFinite(density) && density! > 0.0001;
}

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
  // Off keeps every existing scene rendering exactly as authored; the stylized outdoor look opts in
  // (via a template or render preset) rather than being retrofitted onto projects that never asked.
  aerialFogEnabled: false,
  aerialFogHeightFalloff: 0.02,
  aerialFogSunColor: '#FFE9C0',
  aerialFogInscatter: 0.75,
  aerialFogInscatterPower: 6,
  volumetricFogEnabled: false,
  volumetricFogDensity: 0.1,
  volumetricFogColor: '#cfd8e8',
  volumetricFogHeight: 0,
  volumetricFogFalloff: 0.03,
  volumetricScattering: 0.6,
  volumetricSunStrength: 1.6,
  volumetricMaxDistance: 140,
  wind: [0, 0, 0],
  windTurbulence: 0,
  // ACES + neutral exposure = the look every existing project already renders with, so adding the
  // control changes nothing until the user picks another operator.
  toneMapping: 'aces',
  toneMappingExposure: 1,
  ambientMode: 'flat',
  // Contact shadows default to the values both viewports hardcoded before they were made configurable.
  contactShadows: true,
  contactShadowY: 0,
  contactShadowScale: 14,
  contactShadowOpacity: 0.36,
  contactShadowBlur: 2.4,
  contactShadowFar: 6,
  contactShadowColor: '#000000',
  dayCycleEnabled: false,
  dayCycleDuration: 360,
  dayCycleTime: 0.35,
});

export function withSceneEnvironmentDefaults(
  environment?: Partial<SceneEnvironmentSettings>,
): SceneEnvironmentSettings {
  const result = { ...defaultSceneEnvironment(), ...(environment ?? {}) };
  result.ambientIntensity = Number.isFinite(result.ambientIntensity) ? THREE.MathUtils.clamp(result.ambientIntensity!, 0, 5) : undefined;
  result.sunShadowExtent = Number.isFinite(result.sunShadowExtent) ? THREE.MathUtils.clamp(result.sunShadowExtent!, 8, 256) : undefined;
  for (const key of ['cloudCoverage', 'rainIntensity', 'lightningFlash', 'surfaceWetness', 'puddleCoverage'] as const) {
    result[key] = Number.isFinite(result[key]) ? THREE.MathUtils.clamp(result[key]!, 0, 1) : 0;
  }
  result.cloudSpeed = Number.isFinite(result.cloudSpeed) ? THREE.MathUtils.clamp(result.cloudSpeed!, 0, 5) : 0.35;
  result.skyLighting = result.skyLighting === 'sky' ? 'sky' : 'studio';
  result.wetnessFromRain = result.wetnessFromRain === true;
  return result;
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
