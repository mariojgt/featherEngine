import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vector3Tuple } from '../types';
import { useAssetTexture } from './ModelAsset';

/** Foliage is decorative — never let it catch pointer rays (it would block terrain sculpt/paint). */
const ignoreFoliageRaycast = () => null;

// --- Geometry builders (base at y=0, uv.y 0=base → 1=tip, so the wind shader bends the tip) ---------

/** A tapered grass blade: a vertical strip narrowing toward the tip, with `segments` so it bends smoothly. */
function buildBladeGeometry(width = 0.12, height = 0.6, segments = 4): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const y = t * height;
    const halfW = (width / 2) * (1 - 0.85 * t); // taper to a thin tip
    positions.push(-halfW, y, 0, halfW, y, 0);
    uvs.push(0, t, 1, t);
    normals.push(0, 0, 1, 0, 0, 1);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

/** Two perpendicular upright quads (a "+" billboard) so a 2D sprite reads from every horizontal angle. */
function buildCrossGeometry(width = 0.7, height = 0.8): THREE.BufferGeometry {
  const hw = width / 2;
  const positions = [
    -hw, 0, 0, hw, 0, 0, hw, height, 0, -hw, height, 0, // quad facing +Z
    0, 0, -hw, 0, 0, hw, 0, height, hw, 0, height, -hw, // quad facing +X
  ];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

// Shared singletons — instance matrices scale them per blade/sprite, so geometry is built once.
export const BLADE_GEOMETRY = buildBladeGeometry();
export const GRASS_CROSS_GEOMETRY = buildCrossGeometry(0.7, 0.8);
export const TREE_BILLBOARD_GEOMETRY = buildCrossGeometry(1.0, 1.4);

// --- Wind material ----------------------------------------------------------------------------------
// A MeshStandardMaterial patched (onBeforeCompile) to sway with the GLOBAL scene wind. Per-instance phase
// (from world position) desyncs the blades; the world wind is rotated into each instance's local frame so
// random per-blade yaw still bends the right way. The tip bends quadratically (uv.y²) so the base stays
// planted. A vertical color gradient darkens the base for the classic AAA grass look.
interface WindUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uWindStrength: { value: number };
  uSwaySpeed: { value: number };
  uBaseSway: { value: number };
}

function makeWindMaterial(
  color: string,
  map: THREE.Texture | undefined,
  alphaTest: number,
  uniforms: WindUniforms,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    map: map ?? null,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSwaySpeed = uniforms.uSwaySpeed;
    shader.uniforms.uBaseSway = uniforms.uBaseSway;
    shader.vertexShader =
      'uniform float uTime; uniform vec3 uWind; uniform float uWindStrength; uniform float uSwaySpeed; uniform float uBaseSway; varying float vNfH;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float nfH = uv.y;
        vNfH = nfH;
        #ifdef USE_INSTANCING
          vec3 nfWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          mat3 nfRot = mat3(instanceMatrix);
          vec3 nfLocalWind = transpose(nfRot) * uWind;
        #else
          vec3 nfWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 nfLocalWind = uWind;
        #endif
        float nfT = uTime * uSwaySpeed + nfWorld.x * 0.5 + nfWorld.z * 0.5;
        float nfGust = 0.6 + 0.4 * sin(nfT * 1.7 + 1.3);
        vec2 nfLean = nfLocalWind.xz * uWindStrength * nfGust;
        vec2 nfFlutter = vec2(sin(nfT), cos(nfT * 1.3)) * uBaseSway;
        float nfAmt = nfH * nfH;
        transformed.x += (nfLean.x + nfFlutter.x) * nfAmt;
        transformed.z += (nfLean.y + nfFlutter.y) * nfAmt;`,
      );
    shader.fragmentShader =
      'varying float vNfH;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(0.55, 1.08, vNfH);`,
      );
  };
  material.customProgramCacheKey = () => `nf-wind-foliage-${map ? 'tex' : 'flat'}-${alphaTest}`;
  return material;
}

/**
 * One instanced, wind-animated foliage draw call. Bends with the global scene wind (passed in as a world
 * vector + turbulence) scaled by `windStrength`. `baseSway` is the ambient idle flutter even with no wind.
 */
export function WindFoliage({
  geometry,
  color,
  map,
  matrices,
  windVec,
  turbulence,
  windStrength,
  swaySpeed = 2.0,
  baseSway = 0.03,
  alphaTest = 0,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  map?: THREE.Texture;
  matrices: THREE.Matrix4[];
  windVec: Vector3Tuple;
  turbulence: number;
  windStrength: number;
  swaySpeed?: number;
  baseSway?: number;
  alphaTest?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const uniforms = useRef<WindUniforms>({
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uWindStrength: { value: 0 },
    uSwaySpeed: { value: swaySpeed },
    uBaseSway: { value: baseSway },
  });
  const material = useMemo(
    () => makeWindMaterial(color, map, alphaTest, uniforms.current),
    [color, map, alphaTest],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  useFrame((_, delta) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(delta, 1 / 20) * (1 + turbulence);
    u.uWind.value.set(windVec[0], 0, windVec[2]);
    // 0.03 maps a wind magnitude of ~10 to a believable tip lean; windStrength scales it per-terrain.
    u.uWindStrength.value = 0.03 * windStrength;
    u.uSwaySpeed.value = swaySpeed;
    u.uBaseSway.value = baseSway;
  });

  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, matrices.length]}
      castShadow
      receiveShadow
      // Foliage must never intercept pointer rays — otherwise blades sitting over the terrain swallow
      // sculpt/paint clicks (and the click reads as a "miss", deselecting the terrain).
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true }}
    />
  );
}

/** Wind foliage whose texture comes from an image asset (the 2D-billboard source). */
export function WindFoliageImage({
  assetId,
  geometry,
  color,
  matrices,
  windVec,
  turbulence,
  windStrength,
  swaySpeed,
  baseSway,
}: {
  assetId?: string;
  geometry: THREE.BufferGeometry;
  color: string;
  matrices: THREE.Matrix4[];
  windVec: Vector3Tuple;
  turbulence: number;
  windStrength: number;
  swaySpeed?: number;
  baseSway?: number;
}) {
  const texture = useAssetTexture(assetId, false);
  if (!texture || matrices.length === 0) return null;
  return (
    <WindFoliage
      geometry={geometry}
      color={color}
      map={texture}
      matrices={matrices}
      windVec={windVec}
      turbulence={turbulence}
      windStrength={windStrength}
      swaySpeed={swaySpeed}
      baseSway={baseSway}
      alphaTest={0.4}
    />
  );
}
