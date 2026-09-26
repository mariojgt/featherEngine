import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { NATURAL_GRASS_GEOMETRY, NATURAL_GRASS_DEFAULTS } from '../terrain/naturalGrassGeometry';
import type { StylizedGrassSettings, Vector3Tuple } from '../types';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';
import {
  createNaturalGrassBladeSubset,
  partitionNaturalGrassPlacements,
  type NaturalGrassAssignment,
  type NaturalGrassDetail,
} from './naturalGrassLod';

const MEDIUM_GRASS_GEOMETRY = createNaturalGrassBladeSubset(NATURAL_GRASS_GEOMETRY, 2);
const LOW_GRASS_GEOMETRY = createNaturalGrassBladeSubset(NATURAL_GRASS_GEOMETRY, 4);
const GRASS_DETAIL_GEOMETRIES = [NATURAL_GRASS_GEOMETRY, MEDIUM_GRASS_GEOMETRY, LOW_GRASS_GEOMETRY] as const;
const GRASS_PARTITION_UPDATE_FRAMES = 10;

const ignoreFoliageRaycast = () => null;

export interface NaturalGrassProps {
  color: string;
  settings: StylizedGrassSettings;
  matrices: THREE.Matrix4[];
  windVec: Vector3Tuple;
  turbulence: number;
  windStrength: number;
  interactStrength?: number;
}

interface NaturalGrassUniforms {
  uNgTime: { value: number };
  uNgWind: { value: THREE.Vector3 };
  uNgWindStrength: { value: number };
  uNgWindSpeed: { value: number };
  uNgWindNoiseScale: { value: number };
  uNgBendPivot: { value: number };
  uNgGradientTop: { value: THREE.Color };
  uNgGradientBottom: { value: THREE.Color };
  uNgGradientOffset: { value: number };
  uNgGradientContrast: { value: number };
  uNgNoiseLow: { value: THREE.Color };
  uNgNoiseHigh: { value: THREE.Color };
  uNgNoiseScale: { value: number };
  uNgNoiseStrength: { value: number };
  uNgNormalLift: { value: number };
  uNgPerspective: { value: number };
  uNgPerspectiveStart: { value: number };
  uNgInteractors: { value: THREE.Vector4[] };
  uNgInteractorCount: { value: number };
  uNgInteractStrength: { value: number };
  uNgPushDown: { value: number };
  uNgTrailTint: { value: THREE.Color };
  uNgFade: { value: THREE.Vector3 };
  uNgViewerPosition: { value: THREE.Vector3 };
}

function createUniforms(): NaturalGrassUniforms {
  return {
    uNgTime: { value: 0 },
    uNgWind: { value: new THREE.Vector3() },
    uNgWindStrength: { value: 0 },
    uNgWindSpeed: { value: 0.35 },
    uNgWindNoiseScale: { value: 0.06 },
    uNgBendPivot: { value: 0.2 },
    uNgGradientTop: { value: new THREE.Color('#f0f2d4') },
    uNgGradientBottom: { value: new THREE.Color('#4a4f3e') },
    uNgGradientOffset: { value: 0.05 },
    uNgGradientContrast: { value: 0.45 },
    uNgNoiseLow: { value: new THREE.Color('#eef1c8') },
    uNgNoiseHigh: { value: new THREE.Color('#8fb257') },
    uNgNoiseScale: { value: 0.045 },
    uNgNoiseStrength: { value: 0.35 },
    uNgNormalLift: { value: 0.75 },
    uNgPerspective: { value: 0.55 },
    uNgPerspectiveStart: { value: 0.3 },
    uNgInteractors: foliageInteractorUniforms.uInteractors,
    uNgInteractorCount: foliageInteractorUniforms.uInteractorCount,
    uNgInteractStrength: { value: 0.55 },
    uNgPushDown: { value: 0.35 },
    uNgTrailTint: { value: new THREE.Color('#c9d98f') },
    uNgFade: { value: new THREE.Vector3(45, 70, 2) },
    uNgViewerPosition: { value: new THREE.Vector3() },
  };
}

const NOISE_GLSL = `
float ngHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ngNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ngHash12(i), ngHash12(i + vec2(1.0, 0.0)), f.x),
    mix(ngHash12(i + vec2(0.0, 1.0)), ngHash12(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
`;

const VERTEX_HEADER = `
attribute vec2 bladeRoot;
attribute float bladeRandom;
uniform float uNgTime;
uniform vec3 uNgWind;
uniform float uNgWindStrength;
uniform float uNgWindSpeed;
uniform float uNgWindNoiseScale;
uniform float uNgBendPivot;
uniform float uNgPerspective;
uniform float uNgPerspectiveStart;
uniform vec4 uNgInteractors[${MAX_FOLIAGE_INTERACTORS}];
uniform int uNgInteractorCount;
uniform float uNgInteractStrength;
uniform float uNgPushDown;
uniform vec3 uNgFade;
uniform vec3 uNgViewerPosition;
varying float vNgHeight;
varying float vNgRandom;
varying float vNgInteraction;
varying float vNgFade;
varying float vNgCoverage;
varying vec2 vNgWorldXZ;
${NOISE_GLSL}
`;

const VERTEX_DEFORMATION = `
  float ngHeight = uv.y;
  #ifdef USE_INSTANCING
    vec3 ngRootWorld = (modelMatrix * instanceMatrix * vec4(bladeRoot.x, 0.0, bladeRoot.y, 1.0)).xyz;
    mat3 ngFrame = mat3(modelMatrix) * mat3(instanceMatrix);
  #else
    vec3 ngRootWorld = (modelMatrix * vec4(bladeRoot.x, 0.0, bladeRoot.y, 1.0)).xyz;
    mat3 ngFrame = mat3(modelMatrix);
  #endif
  vec3 ngScale = max(vec3(length(ngFrame[0]), length(ngFrame[1]), length(ngFrame[2])), vec3(0.0001));
  mat3 ngBasis = mat3(ngFrame[0] / ngScale.x, ngFrame[1] / ngScale.y, ngFrame[2] / ngScale.z);
  // Roots follow the surface plane, but stems grow toward world up instead of sticking out of hills.
  vec3 ngGrowthCorrection = (vec3(0.0, ngScale.y, 0.0) - ngFrame[1]) * position.y * 0.9;
  transformed += (transpose(ngBasis) * ngGrowthCorrection) / ngScale;
  float ngBendMask = smoothstep(uNgBendPivot, 1.0, ngHeight);
  ngBendMask *= ngHeight;

  // Both gust layers are sampled in world space and scroll along the global wind vector. Adjacent patches
  // therefore share one travelling wind front, while bladeRandom only adds a small response variation.
  float ngWindMagnitude = min(length(uNgWind.xz), 20.0);
  vec2 ngWindDirection = ngWindMagnitude > 0.0001 ? normalize(uNgWind.xz) : vec2(1.0, 0.0);
  vec2 ngFlow = ngRootWorld.xz * uNgWindNoiseScale - ngWindDirection * (uNgTime * uNgWindSpeed);
  float ngCoarseGust = ngNoise(ngFlow);
  float ngFineGust = ngNoise(ngFlow * 2.37 + vec2(8.1, 3.7));
  float ngGust = mix(ngCoarseGust, ngCoarseGust * ngFineGust * 1.65, 0.45);
  float ngBladeResponse = mix(0.86, 1.12, bladeRandom);
  vec3 ngLeanWorld = vec3(ngWindDirection.x, 0.0, ngWindDirection.y)
    * ngWindMagnitude * uNgWindStrength * (0.25 + ngGust) * ngBladeResponse;
  float ngIdlePhase = uNgTime * 1.35 + dot(ngRootWorld.xz, vec2(0.39, 0.53)) + bladeRandom * 4.0;
  ngLeanWorld += vec3(sin(ngIdlePhase), 0.0, cos(ngIdlePhase * 1.17)) * 0.014 * clamp(uNgWindStrength / 0.028, 0.0, 1.0);

  float ngInteraction = 0.0;
  vec3 ngActorPush = vec3(0.0);
  for (int ngI = 0; ngI < ${MAX_FOLIAGE_INTERACTORS}; ngI++) {
    if (ngI >= uNgInteractorCount) break;
    vec4 ngActor = uNgInteractors[ngI];
    if (ngActor.w <= 0.0) continue;
    vec3 ngDelta = ngRootWorld - ngActor.xyz;
    float ngDistance = length(ngDelta.xz);
    float ngInfluence = 1.0 - smoothstep(ngActor.w * 0.22, ngActor.w, ngDistance);
    ngInfluence *= 1.0 - smoothstep(0.7, 2.5, abs(ngDelta.y));
    vec2 ngAway = ngDistance > 0.0001 ? ngDelta.xz / ngDistance : vec2(1.0, 0.0);
    ngActorPush += vec3(ngAway.x, 0.0, ngAway.y) * ngInfluence;
    ngInteraction = max(ngInteraction, ngInfluence);
  }
  ngActorPush /= max(1.0, length(ngActorPush));
  ngLeanWorld += ngActorPush * uNgInteractStrength;

  vec3 ngToViewer = uNgViewerPosition - ngRootWorld;
  float ngViewDistance = length(ngToViewer);
  vec3 ngViewDirection = ngToViewer / max(ngViewDistance, 0.0001);
  float ngTopDown = clamp(ngViewDirection.y, 0.0, 1.0);
  vec2 ngViewerXZ = length(ngViewDirection.xz) > 0.0001 ? normalize(ngViewDirection.xz) : vec2(0.0, 1.0);
  float ngPerspectiveMask = smoothstep(uNgPerspectiveStart, 1.0, ngHeight);
  ngLeanWorld += vec3(ngViewerXZ.x, 0.0, ngViewerXZ.y) * ngTopDown * uNgPerspective * ngPerspectiveMask * 0.35;

  vec3 ngLeanLocal = transpose(ngBasis) * ngLeanWorld;
  transformed.x += ngLeanLocal.x * ngBendMask / ngScale.x;
  transformed.z += ngLeanLocal.z * ngBendMask / ngScale.z;
  transformed.y -= (ngInteraction * uNgPushDown + length(ngLeanWorld.xz) * 0.08)
    * ngBendMask / ngScale.y;

  float ngFade = 1.0;
  if (uNgFade.z > 0.5) ngFade = 1.0 - smoothstep(uNgFade.x, uNgFade.y, ngViewDistance);
  if (uNgFade.z > 0.5 && uNgFade.z < 1.5) {
    transformed.x = mix(bladeRoot.x, transformed.x, ngFade);
    transformed.z = mix(bladeRoot.y, transformed.z, ngFade);
    transformed.y *= ngFade;
  }
  vNgHeight = ngHeight;
  vNgRandom = bladeRandom;
  vNgInteraction = ngInteraction;
  vNgFade = ngFade;
  // Stable per-blade coverage. The same source blades survive lower detail tiers and all shadow passes.
  vNgCoverage = fract(bladeRandom * 0.754877666 + ngHash12(ngRootWorld.xz * 0.173));
  vNgWorldXZ = ngRootWorld.xz;
`;

const FRAGMENT_HEADER = `
uniform vec3 uNgGradientTop;
uniform vec3 uNgGradientBottom;
uniform float uNgGradientOffset;
uniform float uNgGradientContrast;
uniform vec3 uNgNoiseLow;
uniform vec3 uNgNoiseHigh;
uniform float uNgNoiseScale;
uniform float uNgNoiseStrength;
uniform float uNgNormalLift;
uniform vec3 uNgTrailTint;
uniform vec3 uNgFade;
varying float vNgHeight;
varying float vNgRandom;
varying float vNgInteraction;
varying float vNgFade;
varying float vNgCoverage;
varying vec2 vNgWorldXZ;
${NOISE_GLSL}
`;

const FRAGMENT_COLOR = `
  float ngGradient = clamp((vNgHeight - uNgGradientOffset) / max(0.001, 1.0 - uNgGradientOffset), 0.0, 1.0);
  ngGradient = clamp((ngGradient - 0.5) / max(0.08, 1.0 - uNgGradientContrast * 0.9) + 0.5, 0.0, 1.0);
  ngGradient = ngGradient * ngGradient * (3.0 - 2.0 * ngGradient);
  diffuseColor.rgb *= mix(uNgGradientBottom, uNgGradientTop, ngGradient);
  float ngPatch = ngNoise(vNgWorldXZ * uNgNoiseScale) * 0.65
    + ngNoise(vNgWorldXZ * uNgNoiseScale * 2.1 + 5.7) * 0.35;
  diffuseColor.rgb *= mix(vec3(1.0), mix(uNgNoiseLow, uNgNoiseHigh, ngPatch), uNgNoiseStrength);
  diffuseColor.rgb *= mix(0.88, 1.1, vNgRandom);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uNgTrailTint, vNgInteraction * 0.72);
  if (uNgFade.z > 1.5) {
    if (vNgFade <= vNgCoverage) discard;
  }
`;

const FRAGMENT_NORMAL = `
  vec3 ngUpView = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  normal = normalize(mix(normal, ngUpView, clamp(uNgNormalLift * 0.62, 0.0, 0.82)));
`;

function patchVertexShader(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: NaturalGrassUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = VERTEX_HEADER
    + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_DEFORMATION}`);
}

function createNaturalGrassMaterial(color: string, uniforms: NaturalGrassUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    patchVertexShader(shader, uniforms);
    shader.fragmentShader = FRAGMENT_HEADER
      + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${FRAGMENT_NORMAL}`)
        // A very small diffuse lift keeps razor-thin back faces readable without making the grass unlit.
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * (0.025 + vNgHeight * 0.035);');
  };
  material.customProgramCacheKey = () => 'nf-natural-grass-visible-v2';
  return material;
}

function createShadowMaterials(uniforms: NaturalGrassUniforms): {
  depth: THREE.MeshDepthMaterial;
  distance: THREE.MeshDistanceMaterial;
} {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const distance = new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide });
  for (const material of [depth, distance]) {
    material.onBeforeCompile = (shader) => {
      patchVertexShader(shader, uniforms);
      shader.fragmentShader = `uniform vec3 uNgFade; varying float vNgFade; varying float vNgCoverage;\n${shader.fragmentShader}`
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (uNgFade.z > 1.5) {
            if (vNgFade <= vNgCoverage) discard;
          }`);
    };
    material.customProgramCacheKey = () => 'nf-natural-grass-shadow-v2';
  }
  return { depth, distance };
}

function NaturalGrassInstances({
  detail,
  matrices,
  capacity,
  material,
  shadows,
  boundsPadding,
}: {
  detail: NaturalGrassDetail;
  matrices: THREE.Matrix4[];
  capacity: number;
  material: THREE.MeshStandardMaterial;
  shadows: { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial };
  boundsPadding: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = GRASS_DETAIL_GEOMETRIES[detail];
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere && !mesh.boundingSphere.isEmpty()) {
      mesh.updateWorldMatrix(true, false);
      const scale = mesh.getWorldScale(new THREE.Vector3());
      const minimumScale = Math.max(0.0001, Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
      mesh.boundingSphere.radius += boundsPadding / minimumScale;
    }
  }, [matrices, boundsPadding, capacity, geometry, material]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, capacity]}
      count={matrices.length}
      castShadow={detail === 0}
      receiveShadow
      customDepthMaterial={detail === 0 ? shadows.depth : undefined}
      customDistanceMaterial={detail === 0 ? shadows.distance : undefined}
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true, nfNaturalGrass: true, nfNaturalGrassDetail: detail }}
    />
  );
}

/**
 * Opt-in natural grass. Placements move between deterministic nested blade subsets as the camera moves;
 * the props intentionally match StylizedGrass so TerrainFoliage can switch renderers directly.
 */
export function NaturalGrass({
  color,
  settings,
  matrices,
  windVec,
  turbulence,
  windStrength,
  interactStrength = 1,
}: NaturalGrassProps) {
  const quality = useEditorStore((state) => state.renderSettings.quality ?? 'High');
  const camera = useThree((state) => state.camera);
  const root = useRef<THREE.Group>(null);
  const uniforms = useRef<NaturalGrassUniforms>(createUniforms());
  const material = useMemo(() => createNaturalGrassMaterial(color, uniforms.current), [color]);
  const shadows = useMemo(() => createShadowMaterials(uniforms.current), []);
  const deformationPadding = useMemo(() => {
    const windReach = Math.min(Math.hypot(windVec[0], windVec[2]), 20) * 0.028 * windStrength * 1.8;
    const actorReach = (settings.interactionStrength + settings.pushDownAmount) * interactStrength;
    return windReach * 1.1 + actorReach + settings.perspectiveCorrection * 0.4 + 0.12;
  }, [windVec[0], windVec[2], windStrength, settings.interactionStrength, settings.pushDownAmount, settings.perspectiveCorrection, interactStrength]);
  const [assignments, setAssignments] = useState<NaturalGrassAssignment[]>([]);
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const updateFrame = useRef(0);
  const cameraPosition = useRef(new THREE.Vector3());
  const cameraQuaternion = useRef(new THREE.Quaternion());
  const previousCameraPosition = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const previousCameraQuaternion = useRef(new THREE.Quaternion());
  const previousParentWorld = useRef(new THREE.Matrix4());
  const partitionInitialized = useRef(false);
  const projection = useRef(new THREE.Matrix4());
  const previousProjection = useRef(new THREE.Matrix4());
  const frustum = useRef(new THREE.Frustum());

  const repartition = (resetHysteresis = false, force = false) => {
    if (!root.current) return;
    root.current.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraPosition.current);
    camera.getWorldQuaternion(cameraQuaternion.current);
    if (!force && partitionInitialized.current
      && cameraPosition.current.distanceToSquared(previousCameraPosition.current) < 0.75 * 0.75
      && cameraQuaternion.current.angleTo(previousCameraQuaternion.current) < 0.02
      && camera.projectionMatrix.equals(previousProjection.current)
      && root.current.matrixWorld.equals(previousParentWorld.current)) return;
    previousCameraPosition.current.copy(cameraPosition.current);
    previousCameraQuaternion.current.copy(cameraQuaternion.current);
    previousParentWorld.current.copy(root.current.matrixWorld);
    previousProjection.current.copy(camera.projectionMatrix);
    partitionInitialized.current = true;
    projection.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(projection.current);
    const previous = new Map<string, NaturalGrassDetail>();
    if (!resetHysteresis) {
      for (const assignment of assignmentsRef.current) previous.set(assignment.key, assignment.detail);
    }
    const next = partitionNaturalGrassPlacements(
      matrices,
      cameraPosition.current,
      root.current.matrixWorld,
      quality,
      previous,
      settings.fadeMode === 'off' ? undefined : Math.max(settings.fadeEnd, settings.fadeStart + 1),
      frustum.current,
      NATURAL_GRASS_GEOMETRY.boundingSphere?.radius ?? NATURAL_GRASS_DEFAULTS.patchWidth,
      deformationPadding,
    );
    const current = assignmentsRef.current;
    const changed = next.length !== current.length || next.some((assignment, index) =>
      assignment.key !== current[index]?.key
      || assignment.detail !== current[index]?.detail
      || assignment.matrix !== current[index]?.matrix);
    if (changed) {
      assignmentsRef.current = next;
      setAssignments(next);
    }
  };

  useLayoutEffect(() => {
    material.color.set(color);
  }, [material, color]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => {
    shadows.depth.dispose();
    shadows.distance.dispose();
  }, [shadows]);

  useLayoutEffect(() => repartition(true, true), [matrices, quality, camera, settings.fadeMode, settings.fadeStart, settings.fadeEnd, deformationPadding]);

  useFrame((frame) => {
    const state = useEditorStore.getState();
    const u = uniforms.current;
    u.uNgTime.value = (state.isPlaying ? state.runtimeTime : frame.clock.elapsedTime) * (1 + turbulence);
    u.uNgWind.value.set(windVec[0], 0, windVec[2]);
    u.uNgWindStrength.value = 0.028 * windStrength;
    u.uNgWindSpeed.value = settings.windSpeed;
    u.uNgWindNoiseScale.value = settings.windNoiseScale;
    u.uNgBendPivot.value = settings.bendPivot;
    u.uNgGradientTop.value.set(settings.gradientTop);
    u.uNgGradientBottom.value.set(settings.gradientBottom);
    u.uNgGradientOffset.value = settings.gradientOffset;
    u.uNgGradientContrast.value = settings.gradientContrast;
    u.uNgNoiseLow.value.set(settings.colorNoiseLow);
    u.uNgNoiseHigh.value.set(settings.colorNoiseHigh);
    u.uNgNoiseScale.value = settings.colorNoiseScale;
    u.uNgNoiseStrength.value = settings.colorNoiseStrength;
    u.uNgNormalLift.value = settings.normalLift;
    u.uNgPerspective.value = settings.perspectiveCorrection;
    u.uNgPerspectiveStart.value = settings.perspectiveHeightStart;
    u.uNgInteractStrength.value = settings.interactionStrength * interactStrength;
    u.uNgPushDown.value = settings.pushDownAmount * interactStrength;
    u.uNgTrailTint.value.set(settings.trailTint);
    u.uNgFade.value.set(
      settings.fadeStart,
      Math.max(settings.fadeEnd, settings.fadeStart + 1),
      settings.fadeMode === 'smooth' ? 1 : settings.fadeMode === 'dither' ? 2 : 0,
    );
    frame.camera.getWorldPosition(u.uNgViewerPosition.value);
    if (++updateFrame.current >= GRASS_PARTITION_UPDATE_FRAMES) {
      updateFrame.current = 0;
      repartition();
    }
  });

  const partitions = useMemo(() => {
    const result: [THREE.Matrix4[], THREE.Matrix4[], THREE.Matrix4[]] = [[], [], []];
    for (const assignment of assignments) result[assignment.detail].push(assignment.matrix);
    return result;
  }, [assignments]);

  if (matrices.length === 0) return null;
  return (
    <group ref={root}>
      {GRASS_DETAIL_GEOMETRIES.map((_, detail) => (
        <NaturalGrassInstances
          key={detail}
          detail={detail as NaturalGrassDetail}
          matrices={partitions[detail]}
          capacity={matrices.length}
          material={material}
          shadows={shadows}
          boundsPadding={deformationPadding}
        />
      ))}
    </group>
  );
}
