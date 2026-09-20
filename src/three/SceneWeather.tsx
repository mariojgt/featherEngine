import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { SceneEnvironmentSettings } from '../types';
import { advanceWeatherDrift, type WeatherDrift } from './weatherMotion';

/** Seeded, world-anchored drops wrap outside the view instead of following camera movement. */
export function createRainGeometry(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 6), seeds = new Float32Array(count * 6);
  let seed = 7319;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const x = random(), y = random(), z = random();
    for (let end = 0; end < 2; end++) {
      const j = i * 6 + end * 3;
      positions[j + 1] = end;
      seeds[j] = x; seeds[j + 1] = y; seeds[j + 2] = z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('dropSeed', new THREE.BufferAttribute(seeds, 3));
  return geometry;
}

const vertexShader = /* glsl */ `
attribute vec3 dropSeed;
uniform float weatherTime;
uniform vec3 weatherWind;
uniform vec2 weatherDrift;
varying float dropAlpha;
void main() {
  vec3 velocity = vec3(weatherWind.x * 0.7, -22.0, weatherWind.z * 0.7);
  vec3 size = vec3(100.0, 58.0, 100.0);
  vec3 anchor = dropSeed * size + vec3(weatherDrift.x, velocity.y * weatherTime, weatherDrift.y);
  vec3 world = mod(anchor - cameraPosition + size * 0.5, size) + cameraPosition - size * 0.5;
  world += normalize(velocity) * position.y * (0.45 + dropSeed.z * 0.65);
  float distanceToCamera = length(world - cameraPosition);
  dropAlpha = (1.0 - smoothstep(25.0, 60.0, distanceToCamera)) * smoothstep(0.8, 2.0, distanceToCamera);
  dropAlpha *= mix(0.25, 1.0, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;
const fragmentShader = /* glsl */ `
uniform float flash;
varying float dropAlpha;
void main() {
  gl_FragColor = vec4(mix(vec3(0.48, 0.60, 0.70), vec3(0.87, 0.93, 1.0), flash), dropAlpha * (0.32 + flash * 0.35));
}
`;

export function SceneWeather({ environment }: { environment: SceneEnvironmentSettings }) {
  const quality = useEditorStore(s => s.renderSettings.quality);
  const budget = quality === 'Low' ? 600 : quality === 'Medium' ? 1400 : quality === 'Epic' ? 4200 : 2800;
  const geometry = useMemo(() => createRainGeometry(budget), [budget]);
  const drift = useRef<WeatherDrift>({ x: 0, z: 0 });
  const uniforms = useRef({ weatherTime: { value: 0 }, weatherWind: { value: new THREE.Vector3() }, weatherDrift: { value: new THREE.Vector2() }, flash: { value: 0 } });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    const s = useEditorStore.getState();
    uniforms.current.weatherTime.value = s.isPlaying ? s.runtimeTime : clock.elapsedTime;
    uniforms.current.weatherWind.value.fromArray(environment.wind ?? [0, 0, 0]);
    const wind = environment.wind ?? [0, 0, 0];
    advanceWeatherDrift(drift.current, uniforms.current.weatherTime.value, wind[0] * 0.7, wind[2] * 0.7);
    uniforms.current.weatherDrift.value.set(drift.current.x, drift.current.z);
    uniforms.current.flash.value = environment.lightningFlash ?? 0;
    geometry.setDrawRange(0, Math.floor(budget * (environment.rainIntensity ?? 0)) * 2);
  });
  return (
    <>
      <directionalLight position={[-80, 100, -100]} color="#c3d7ff" intensity={(environment.lightningFlash ?? 0) * 5} />
      <ambientLight color="#c9dbff" intensity={(environment.lightningFlash ?? 0) * 0.45} />
      <lineSegments geometry={geometry} frustumCulled={false} renderOrder={20} raycast={() => null}>
        <shaderMaterial uniforms={uniforms.current} vertexShader={vertexShader} fragmentShader={fragmentShader}
          transparent depthWrite={false} toneMapped={false} />
      </lineSegments>
    </>
  );
}
