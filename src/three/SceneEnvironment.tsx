import { Environment, Lightformer } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { SceneEnvironmentSettings } from '../types';
import { useAssetTexture, useAssetUrl } from './ModelAsset';
import {
  sunDirectionFromEnvironment,
  sunPositionFromEnvironment,
  withSceneEnvironmentDefaults,
} from './environmentSettings';
import { withDayCycleVisuals } from './dayCycle';
import { useEditorStore } from '../store/editorStore';
import { qualityProfile, SHADOW_NORMAL_BIAS } from './quality';
import { resetAerialFog, setAerialFog } from './aerialFog';

const skyVertexShader = `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const skyFragmentShader = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float sunIntensity;
varying vec3 vDirection;

void main() {
  float height = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
  float upper = smoothstep(0.44, 1.0, height);
  float lower = smoothstep(0.0, 0.46, height);
  vec3 lowerSky = mix(groundColor, horizonColor, lower);
  vec3 upperSky = mix(horizonColor, topColor, upper);
  vec3 color = mix(lowerSky, upperSky, smoothstep(0.45, 0.55, height));

  float sunDisc = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 720.0);
  float sunGlow = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 18.0);
  color += sunColor * (sunDisc * 1.8 + sunGlow * 0.2) * sunIntensity;

  gl_FragColor = vec4(color, 1.0);
}
`;

function CameraLockedSky({
  children,
  rotationY = 0,
}: {
  children: ReactNode;
  rotationY?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-1000} frustumCulled={false} rotation={[0, rotationY, 0]}>
      <sphereGeometry args={[500, 64, 32]} />
      {children}
    </mesh>
  );
}

function ProceduralSky({ environment }: { environment: SceneEnvironmentSettings }) {
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(environment.skyTopColor) },
      horizonColor: { value: new THREE.Color(environment.skyHorizonColor) },
      groundColor: { value: new THREE.Color(environment.skyGroundColor) },
      sunColor: { value: new THREE.Color(environment.sunColor) },
      sunDirection: { value: sunDirectionFromEnvironment(environment) },
      sunIntensity: { value: environment.sunIntensity },
    }),
    [],
  );

  useEffect(() => {
    uniforms.topColor.value.set(environment.skyTopColor);
    uniforms.horizonColor.value.set(environment.skyHorizonColor);
    uniforms.groundColor.value.set(environment.skyGroundColor);
    uniforms.sunColor.value.set(environment.sunColor);
    uniforms.sunDirection.value.copy(sunDirectionFromEnvironment(environment));
    uniforms.sunIntensity.value = environment.sunIntensity;
  }, [environment, uniforms]);

  return (
    <CameraLockedSky rotationY={THREE.MathUtils.degToRad(environment.skyRotation)}>
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
      />
    </CameraLockedSky>
  );
}

function ImageSky({ environment }: { environment: SceneEnvironmentSettings }) {
  const url = useAssetUrl(environment.skyTextureAssetId);
  const texture = useAssetTexture(url, true);

  useEffect(() => {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }, [texture]);

  if (!texture) return null;

  return (
    <CameraLockedSky rotationY={THREE.MathUtils.degToRad(environment.skyRotation)}>
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} depthTest={false} toneMapped={false} />
    </CameraLockedSky>
  );
}

/**
 * Feeds the scene's sun + aerial settings into the shared fog uniforms from `aerialFog.ts`. Those
 * uniform objects are shared by reference across every fogged material, so this one effect updates
 * the whole scene at once — there is no per-material bookkeeping to do.
 *
 * Disabled scenes are actively reset rather than just skipped, because the uniforms are global: a
 * scene with aerial fog off would otherwise inherit whatever the last scene left behind.
 */
function AerialFogSync({ environment }: { environment: SceneEnvironmentSettings }) {
  const enabled = Boolean(environment.aerialFogEnabled) && environment.fogEnabled;
  const sunDirection = useMemo(() => sunDirectionFromEnvironment(environment), [environment]);

  useEffect(() => {
    if (!enabled) {
      resetAerialFog();
      return;
    }
    setAerialFog({
      sunDirection,
      sunColor: environment.aerialFogSunColor ?? environment.sunColor,
      heightFalloff: environment.aerialFogHeightFalloff ?? 0.02,
      inscatterPower: environment.aerialFogInscatterPower ?? 6,
      inscatter: environment.aerialFogInscatter ?? 0.75,
    });
    return () => resetAerialFog();
  }, [enabled, sunDirection, environment]);

  return null;
}

export function SceneEnvironment({
  environment,
  shadows = false,
}: {
  environment?: Partial<SceneEnvironmentSettings>;
  shadows?: boolean;
}) {
  const dayCycleTime = useEditorStore((state) => state.runtimeDayCycleTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  // During Play (and when the cycle is on in the editor), drive sun/sky from the day-cycle ramp.
  const env = useMemo(() => {
    const resolved = withSceneEnvironmentDefaults(environment);
    if (!resolved.dayCycleEnabled) return resolved;
    const t = isPlaying ? dayCycleTime : (resolved.dayCycleTime ?? 0.35);
    return withDayCycleVisuals(resolved, t);
  }, [environment, dayCycleTime, isPlaying]);
  const sunPosition = useMemo(() => sunPositionFromEnvironment(env), [env]);
  const lightIntensity = Math.max(0, env.environmentIntensity);
  // IBL cubemap resolution follows the quality preset — sharper reflections at High/Epic.
  const profile = qualityProfile(useEditorStore((state) => state.renderSettings?.quality));
  const envResolution = profile.envResolution;
  // The sun also casts shadows when volumetric fog is on (even in the editor viewport, which otherwise
  // skips sun shadows) — the volumetric pass samples that shadow map to carve god-ray light shafts.
  const castSunShadow = shadows || (Boolean(env.volumetricFogEnabled) && profile.shadows);

  // Optional image-based lighting: an equirectangular panorama/HDRI drives ambient + reflections,
  // replacing the studio Lightformer rig when set. Loads the same way as any image asset.
  const envMapUrl = useAssetUrl(env.environmentMapAssetId);
  const envMapTexture = useAssetTexture(envMapUrl, false);
  useEffect(() => {
    if (envMapTexture) envMapTexture.mapping = THREE.EquirectangularReflectionMapping;
  }, [envMapTexture]);
  const useImageIbl = Boolean(env.environmentMapAssetId && envMapTexture);
  const iblRotation = useMemo(
    () => new THREE.Euler(0, THREE.MathUtils.degToRad(env.skyRotation), 0),
    [env.skyRotation],
  );

  // Tier 7.2 — atmospheric fog: sample the fog color from the sky so distant geometry dissolves into it.
  // Procedural sky → the horizon band tinted slightly toward the zenith; other sky modes → the background
  // color (image panoramas can't be cheaply sampled, so fall back to the authored fog color if set).
  const atmosphericFogColor = useMemo(() => {
    if (env.skyMode === 'procedural') {
      return `#${new THREE.Color(env.skyHorizonColor).lerp(new THREE.Color(env.skyTopColor), 0.25).getHexString()}`;
    }
    if (env.skyMode === 'image') return env.fogColor;
    return env.backgroundColor;
  }, [env.skyMode, env.skyHorizonColor, env.skyTopColor, env.backgroundColor, env.fogColor]);
  // Map the existing fogFar control to an exponential density (thicker as fogFar shrinks). ~85% opaque at
  // fogFar, so the range dial still reads intuitively while the curve gives soft aerial perspective.
  const atmosphericFogDensity = 1.9 / Math.max(20, env.fogFar);

  return (
    <>
      <color attach="background" args={[env.backgroundColor]} />
      {/* Distance fog. Suppressed when volumetric fog is on (PostFx) to avoid doubled haze — the
          volumetric pass replaces it with height-based mist + sun in-scattering. Atmospheric mode swaps
          the flat linear haze for sky-colored exponential aerial perspective (Tier 7.2). */}
      {env.fogEnabled && !env.volumetricFogEnabled && (
        env.atmosphericFog ? (
          <fogExp2 attach="fog" args={[atmosphericFogColor, Math.max(0.0002, atmosphericFogDensity)]} />
        ) : (
          <fog attach="fog" args={[env.fogColor, Math.max(0, env.fogNear), Math.max(env.fogNear + 1, env.fogFar)]} />
        )
      )}
      {/* Height falloff + sun in-scatter on top of whichever fog model is active. Also gated on
          volumetric fog, so the two haze systems never stack. */}
      {!env.volumetricFogEnabled && <AerialFogSync environment={env} />}

      {/* Ambient fill. `hemisphere` grades sky→ground so undersides read cooler/darker; `flat` is the
          legacy constant term. Same intensity either way, so switching is purely a quality choice. */}
      {env.ambientMode === 'hemisphere' ? (
        <hemisphereLight
          color={env.skyTopColor}
          groundColor={env.skyGroundColor}
          intensity={0.38 + lightIntensity * 0.24}
        />
      ) : (
        <ambientLight intensity={0.38 + lightIntensity * 0.24} />
      )}
      {/* The sun. The shadow camera is explicitly framed (not the tiny three.js ±5 default) so it covers
          the play area — this is the shadow map the volumetric pass samples to carve god-ray light shafts,
          so if the frustum is too small every fog sample reads "lit" and no shafts appear. Map size follows
          the quality tier; bias/normalBias kill acne (which would otherwise stripe the shafts). */}
      <directionalLight
        position={sunPosition}
        color={env.sunColor}
        intensity={Math.max(0, env.sunIntensity)}
        castShadow={castSunShadow}
        shadow-mapSize-width={profile.shadowMapSize}
        shadow-mapSize-height={profile.shadowMapSize}
        shadow-bias={-0.0004}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-radius={profile.shadowMapSize >= 2048 ? 2.25 : 1.25}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
      {useImageIbl ? (
        <Environment map={envMapTexture} environmentIntensity={lightIntensity} environmentRotation={iblRotation} />
      ) : (
        // Default studio IBL rig — a soft 3-point + rim + bounce setup so metals/glossy surfaces get
        // believable reflections and shading separation before any HDRI is assigned. All scaled by
        // environmentIntensity. (Replaced the old flat 3-light rig.)
        <Environment resolution={envResolution}>
          {/* Big soft overhead key — the dominant light, broad and slightly forward. */}
          <Lightformer intensity={1.5 * lightIntensity} form="rect" position={[0, 7, 2]} rotation={[-Math.PI / 2, 0, 0]} scale={[12, 12, 1]} color="#fff4e6" />
          {/* Cool sky fill from the right, large and dim — opens up the shadow side. */}
          <Lightformer intensity={0.6 * lightIntensity} form="rect" position={[7, 3, 4]} scale={[7, 7, 1]} color="#9bb4ff" />
          {/* Warm bounce from the lower left — mimics ground/wall fill. */}
          <Lightformer intensity={0.4 * lightIntensity} form="rect" position={[-7, 1.5, -3]} scale={[7, 7, 1]} color="#ffd6a5" />
          {/* Bright thin rim behind the subject — crisp edge highlights on metal/glossy surfaces. */}
          <Lightformer intensity={1.8 * lightIntensity} form="rect" position={[0, 4, -8]} scale={[10, 2, 1]} color="#ffffff" />
          {/* Subtle ground bounce so undersides aren't pure black. */}
          <Lightformer intensity={0.25 * lightIntensity} form="rect" position={[0, -4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} color="#c9d2e0" />
        </Environment>
      )}

      {env.skyMode === 'procedural' && <ProceduralSky environment={env} />}
      {env.skyMode === 'image' && <ImageSky environment={env} />}
    </>
  );
}
