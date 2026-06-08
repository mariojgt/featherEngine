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
import { useEditorStore } from '../store/editorStore';
import { qualityProfile } from './quality';

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

export function SceneEnvironment({
  environment,
  shadows = false,
}: {
  environment?: Partial<SceneEnvironmentSettings>;
  shadows?: boolean;
}) {
  const env = withSceneEnvironmentDefaults(environment);
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

  return (
    <>
      <color attach="background" args={[env.backgroundColor]} />
      {/* Linear distance fog. Suppressed when volumetric fog is on (PostFx) to avoid doubled haze —
          the volumetric pass replaces it with height-based mist + sun in-scattering. */}
      {env.fogEnabled && !env.volumetricFogEnabled && <fog attach="fog" args={[env.fogColor, Math.max(0, env.fogNear), Math.max(env.fogNear + 1, env.fogFar)]} />}

      <ambientLight intensity={0.38 + lightIntensity * 0.24} />
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
        shadow-normalBias={0.02}
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
        <Environment resolution={envResolution}>
          <Lightformer intensity={1.2 * lightIntensity} position={[0, 6, 0]} scale={[10, 10, 1]} />
          <Lightformer intensity={0.7 * lightIntensity} position={[6, 3, 4]} scale={[6, 6, 1]} color="#8aa0ff" />
          <Lightformer intensity={0.5 * lightIntensity} position={[-6, 2, -4]} scale={[6, 6, 1]} color="#ffd6a5" />
        </Environment>
      )}

      {env.skyMode === 'procedural' && <ProceduralSky environment={env} />}
      {env.skyMode === 'image' && <ImageSky environment={env} />}
    </>
  );
}
