import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityLevel, Vector3Tuple } from '../types';
import { useEditorStore } from '../store/editorStore';

const LOD_COUNT = 3;
const LOD_UPDATE_FRAMES = 8;
const MAX_WIND_MAGNITUDE = 12;
const EMPTY_MATRICES: THREE.Matrix4[] = [];
const noRaycast = () => null;

export interface AuthoredTreeMetadata {
  variant: number;
  lod: number;
  height: number;
}

interface AuthoredTreeMesh extends AuthoredTreeMetadata {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

interface TreeWindUniforms {
  uTreeTime: { value: number };
  uTreeWind: { value: THREE.Vector3 };
  uTreeTurbulence: { value: number };
  uTreeViewerPosition: { value: THREE.Vector3 };
  uTreeFade: { value: THREE.Vector3 };
}

interface TreePartResource extends AuthoredTreeMetadata {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depthMaterial: THREE.MeshDepthMaterial;
  distanceMaterial: THREE.MeshDistanceMaterial;
  ownedGeometry: boolean;
}

export interface AuthoredTreeAssignment {
  key: string;
  matrix: THREE.Matrix4;
  variant: number;
  lod: number;
}

const finiteInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : undefined;

const finitePositive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/** Resolve glTF extras from the nearest declaring ancestor, as GLTFLoader may add primitive children. */
export function authoredTreeMetadata(node: THREE.Object3D): AuthoredTreeMetadata | null {
  let variant: number | undefined;
  let lod: number | undefined;
  let height: number | undefined;
  for (let current: THREE.Object3D | null = node; current; current = current.parent) {
    variant ??= finiteInteger(current.userData.featherTreeVariant);
    lod ??= finiteInteger(current.userData.featherTreeLod);
    height ??= finitePositive(current.userData.featherTreeHeight);
  }
  if (variant === undefined || variant < 0) return null;
  if (lod === undefined || lod < 0 || lod >= LOD_COUNT) return null;
  if (height === undefined) return null;
  return { variant, lod, height };
}

function collectAuthoredTreeMeshes(scene: THREE.Object3D): AuthoredTreeMesh[] {
  const parts: AuthoredTreeMesh[] = [];
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
    const metadata = authoredTreeMetadata(mesh);
    if (!metadata) return;
    parts.push({ id: mesh.uuid, geometry: mesh.geometry, material: mesh.material, ...metadata });
  });
  return parts;
}

/** Stable placement hash: variant choice does not depend on streaming/order changes. */
export function authoredTreePlacementHash(matrix: THREE.Matrix4): number {
  let hash = 2166136261;
  for (const value of matrix.elements) {
    hash = Math.imul(hash ^ Math.round(value * 10_000), 16777619);
  }
  return hash >>> 0;
}

const qualityDistanceScale = (quality: QualityLevel): number =>
  quality === 'Low' ? 0.65 : quality === 'Medium' ? 0.85 : quality === 'Epic' ? 1.25 : 1;

/** Scale-aware three-level selection with a 24% dead band around each transition. */
export function selectAuthoredTreeLod(
  distance: number,
  authoredHeight: number,
  instanceScale: number,
  quality: QualityLevel,
  previous = 0,
  lodDistances?: readonly [number, number],
): number {
  const normalizedDistance = Math.max(0, distance) /
    Math.max(0.001, Math.abs(instanceScale) * qualityDistanceScale(quality));
  const height = Math.max(0.001, authoredHeight);
  const customDistances = lodDistances
    && Number.isFinite(lodDistances[0])
    && Number.isFinite(lodDistances[1])
    && lodDistances[0] >= 0
    && lodDistances[1] > lodDistances[0]
    ? lodDistances
    : undefined;
  const thresholds = customDistances ?? [height * 3, height * 7];
  let next = THREE.MathUtils.clamp(Math.trunc(previous), 0, LOD_COUNT - 1);
  while (next < LOD_COUNT - 1 && normalizedDistance > thresholds[next] * 1.12) next += 1;
  while (next > 0 && normalizedDistance < thresholds[next - 1] * 0.88) next -= 1;
  return next;
}

export function partitionAuthoredTreePlacements(
  matrices: readonly THREE.Matrix4[],
  variants: readonly number[],
  heights: ReadonlyMap<number, number>,
  cameraWorldPosition: THREE.Vector3,
  parentWorldMatrix: THREE.Matrix4,
  quality: QualityLevel,
  previousLods: ReadonlyMap<string, number> = new Map(),
  lodDistances?: readonly [number, number],
  fadeDistance?: readonly [number, number],
): AuthoredTreeAssignment[] {
  if (variants.length === 0) return [];
  const world = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const fadeEnd = fadeDistance
    && Number.isFinite(fadeDistance[0])
    && Number.isFinite(fadeDistance[1])
    && fadeDistance[0] >= 0
    && fadeDistance[1] > fadeDistance[0]
    ? fadeDistance[1]
    : undefined;
  return matrices.flatMap((matrix) => {
    const hash = authoredTreePlacementHash(matrix);
    // Include all quantized elements in the state key. Hash collisions must not share hysteresis state.
    const key = matrix.elements.map((value) => Math.round(value * 10_000)).join(',');
    const variant = variants[hash % variants.length];
    world.multiplyMatrices(parentWorldMatrix, matrix);
    position.setFromMatrixPosition(world);
    const distance = position.distanceTo(cameraWorldPosition);
    const instanceScale = world.getMaxScaleOnAxis();
    if (fadeEnd !== undefined
      && distance > fadeEnd + authoredTreeWindMargin(heights.get(variant) ?? 1) * instanceScale) return [];
    const lod = selectAuthoredTreeLod(
      distance,
      heights.get(variant) ?? 1,
      instanceScale,
      quality,
      previousLods.get(key) ?? LOD_COUNT - 1,
      lodDistances,
    );
    return [{ key, matrix, variant, lod }];
  });
}

/** Conservative local-space headroom for the shader's capped bend plus three-axis leaf flutter. */
export function authoredTreeWindMargin(height: number): number {
  return Math.max(0, height) * MAX_WIND_MAGNITUDE * (0.0045 + Math.sqrt(3) * 0.0009);
}

const WIND_VERTEX_HEADER = `
uniform float uTreeTime;
uniform vec3 uTreeWind;
uniform float uTreeTurbulence;
uniform float uTreeHeight;
uniform float uTreeLeaves;
uniform vec3 uTreeViewerPosition;
uniform vec3 uTreeFade;
varying float vTreeFadeCoverage;
`;

const WIND_VERTEX_BODY = `
  float nfTreeH = clamp(transformed.y / max(uTreeHeight, 0.001), 0.0, 1.0);
  float nfTreeWeight = nfTreeH * nfTreeH;
  #ifdef USE_INSTANCING
    mat3 nfTreeWorldBasis = mat3(modelMatrix * instanceMatrix);
    vec3 nfTreeRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    mat3 nfTreeWorldBasis = mat3(modelMatrix);
    vec3 nfTreeRoot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  vec3 nfTreeAxisX = normalize(nfTreeWorldBasis[0]);
  vec3 nfTreeAxisY = normalize(nfTreeWorldBasis[1]);
  vec3 nfTreeAxisZ = normalize(nfTreeWorldBasis[2]);
  float nfTreeViewDistance = distance(uTreeViewerPosition, nfTreeRoot);
  float nfTreeFadeAmount = uTreeFade.z > 0.5
    ? 1.0 - smoothstep(uTreeFade.x, uTreeFade.y, nfTreeViewDistance)
    : 1.0;
  float nfTreeIdentity = fract(sin(dot(nfTreeRoot.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vTreeFadeCoverage = nfTreeFadeAmount - nfTreeIdentity;
  vec3 nfTreeLocalWind = vec3(dot(uTreeWind, nfTreeAxisX), dot(uTreeWind, nfTreeAxisY), dot(uTreeWind, nfTreeAxisZ));
  float nfTreeWindMag = min(length(uTreeWind.xz), ${MAX_WIND_MAGNITUDE.toFixed(1)});
  vec2 nfTreeDir = length(nfTreeLocalWind.xz) > 0.0001 ? normalize(nfTreeLocalWind.xz) : vec2(1.0, 0.0);
  float nfTreeTurb = clamp(uTreeTurbulence, 0.0, 1.0);
  float nfTreePhase = uTreeTime * (0.72 + nfTreeTurb * 0.7) + dot(nfTreeRoot.xz, vec2(0.19, 0.27));
  float nfTreeGust = mix(0.82, 0.62 + 0.38 * (0.5 + 0.5 * sin(nfTreePhase)), nfTreeTurb);
  transformed.xz += nfTreeDir * (uTreeHeight * 0.0045 * nfTreeWindMag * nfTreeWeight * nfTreeGust);
  float nfTreeFlutter = uTreeHeight * 0.0009 * nfTreeWindMag * nfTreeWeight * uTreeLeaves * (0.35 + 0.65 * nfTreeTurb);
  transformed.x += sin(nfTreePhase * 5.7 + transformed.y * 1.31 + transformed.z * 0.47) * nfTreeFlutter;
  transformed.y += sin(nfTreePhase * 7.1 + transformed.x * 0.83) * nfTreeFlutter;
  transformed.z += cos(nfTreePhase * 6.3 + transformed.y * 1.07 + transformed.x * 0.39) * nfTreeFlutter;
`;

const TREE_FADE_FRAGMENT_HEADER = `
varying float vTreeFadeCoverage;
`;

const TREE_FADE_FRAGMENT = `
  if (vTreeFadeCoverage < 0.0) discard;
`;

const THIN_LEAF_LIGHTING = `
void nfThinLeafDirect(
  const in IncidentLight directLight,
  const in vec3 geometryPosition,
  const in vec3 geometryNormal,
  const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material,
  inout ReflectedLight reflectedLight
) {
  RE_Direct_Physical(
    directLight,
    geometryPosition,
    geometryNormal,
    geometryViewDir,
    geometryClearcoatNormal,
    material,
    reflectedLight
  );
  float nfLeafNL = dot(geometryNormal, directLight.direction);
  float nfLeafFront = saturate(nfLeafNL);
  float nfLeafWrapped = saturate((nfLeafNL + 0.42) / 1.42);
  float nfLeafBack = pow(saturate(-nfLeafNL), 1.35);
  float nfLeafSoftResponse = max(0.0, nfLeafWrapped - nfLeafFront) * 0.32 + nfLeafBack * 0.48;
  reflectedLight.directDiffuse += nfLeafSoftResponse * directLight.color * BRDF_Lambert(material.diffuseColor);
}
#undef RE_Direct
#define RE_Direct nfThinLeafDirect
`;

/** Add shadow-aware wrapped diffuse and thin-leaf back transmission to a standard/physical shader. */
export function patchThinLeafLightingShader(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
  if (shader.fragmentShader.includes('nfThinLeafDirect')) return;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_physical_pars_fragment>',
    `#include <lights_physical_pars_fragment>\n${THIN_LEAF_LIGHTING}`,
  );
}

function patchTreeFadeFragment(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
  shader.fragmentShader = TREE_FADE_FRAGMENT_HEADER + shader.fragmentShader.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>\n${TREE_FADE_FRAGMENT}`,
  );
}

function patchWindShader(
  shader: Parameters<THREE.Material['onBeforeCompile']>[0],
  uniforms: TreeWindUniforms,
  height: number,
  leaves: boolean,
): void {
  Object.assign(shader.uniforms, uniforms, {
    uTreeHeight: { value: height },
    uTreeLeaves: { value: leaves ? 1 : 0 },
  });
  shader.vertexShader = WIND_VERTEX_HEADER + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>\n${WIND_VERTEX_BODY}`,
  );
}

function sourceAlpha(source: THREE.Material) {
  const material = source as THREE.Material & {
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    alphaTest?: number;
    opacity?: number;
  };
  return {
    map: material.map ?? null,
    alphaMap: material.alphaMap ?? null,
    alphaTest: Math.max(material.alphaTest ?? 0, source.transparent && material.map ? 0.01 : 0),
    opacity: material.opacity ?? 1,
    side: source.side,
  };
}

function isLeafMaterial(source: THREE.Material): boolean {
  const alpha = sourceAlpha(source);
  return alpha.alphaTest > 0 || source.transparent || alpha.alphaMap !== null || /leaf|leaves|foliage|needle/i.test(source.name);
}

function makeVisibleMaterial(source: THREE.Material, uniforms: TreeWindUniforms, height: number, leaves: boolean): THREE.Material {
  const material = source.clone();
  const beforeCompile = material.onBeforeCompile;
  const sourceProgramKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    beforeCompile.call(material, shader, renderer);
    patchWindShader(shader, uniforms, height, leaves);
    patchTreeFadeFragment(shader);
    if (leaves) patchThinLeafLightingShader(shader);
  };
  material.customProgramCacheKey = () => `${sourceProgramKey}:nf-authored-tree-visible-v2:${leaves ? 'leaf' : 'trunk'}`;
  material.needsUpdate = true;
  return material;
}

function makeShadowMaterial(
  source: THREE.Material,
  uniforms: TreeWindUniforms,
  height: number,
  leaves: boolean,
  distance: boolean,
): THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial {
  const alpha = sourceAlpha(source);
  const material = distance
    ? new THREE.MeshDistanceMaterial(alpha)
    : new THREE.MeshDepthMaterial({ ...alpha, depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    patchWindShader(shader, uniforms, height, leaves);
    patchTreeFadeFragment(shader);
  };
  material.customProgramCacheKey = () =>
    `nf-authored-tree-shadow-v2:${distance ? 'distance' : 'depth'}:${leaves ? 'leaf' : 'trunk'}:${alpha.alphaTest}`;
  return material;
}

/** A draw-range-only geometry wrapper; source attributes/index remain owned by useGLTF. */
function geometryGroupView(source: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.morphAttributes = source.morphAttributes;
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setDrawRange(start, count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

function createPartResource(
  id: string,
  sourceGeometry: THREE.BufferGeometry,
  sourceMaterial: THREE.Material,
  metadata: AuthoredTreeMetadata,
  uniforms: TreeWindUniforms,
  ownedGeometry = false,
): TreePartResource {
  const leaves = isLeafMaterial(sourceMaterial);
  return {
    id,
    geometry: sourceGeometry,
    material: makeVisibleMaterial(sourceMaterial, uniforms, metadata.height, leaves),
    depthMaterial: makeShadowMaterial(sourceMaterial, uniforms, metadata.height, leaves, false) as THREE.MeshDepthMaterial,
    distanceMaterial: makeShadowMaterial(sourceMaterial, uniforms, metadata.height, leaves, true) as THREE.MeshDistanceMaterial,
    ownedGeometry,
    ...metadata,
  };
}

function createPartResources(meshes: AuthoredTreeMesh[], uniforms: TreeWindUniforms): TreePartResource[] {
  return meshes.flatMap((mesh) => {
    if (!Array.isArray(mesh.material)) {
      return [createPartResource(mesh.id, mesh.geometry, mesh.material, mesh, uniforms)];
    }
    const materials = mesh.material;
    // GLTFLoader normally emits one child Mesh per primitive. Retain support for grouped multi-material
    // meshes without mutating or cloning their (potentially very large) source vertex buffers.
    const groups = mesh.geometry.groups.length
      ? mesh.geometry.groups
      : [{ start: mesh.geometry.drawRange.start, count: mesh.geometry.drawRange.count, materialIndex: 0 }];
    return groups.flatMap((group, index) => {
      const sourceMaterial = materials[group.materialIndex ?? 0];
      if (!sourceMaterial) return [];
      const geometry = geometryGroupView(mesh.geometry, group.start, group.count);
      return [createPartResource(`${mesh.id}:${index}`, geometry, sourceMaterial, mesh, uniforms, true)];
    });
  });
}

function AuthoredTreeInstances({
  part,
  matrices,
  capacity,
}: {
  part: TreePartResource;
  matrices: THREE.Matrix4[];
  capacity: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    let maxScale = 1;
    for (const matrix of matrices) maxScale = Math.max(maxScale, matrix.getMaxScaleOnAxis());
    if (mesh.boundingSphere && !mesh.boundingSphere.isEmpty()) {
      mesh.boundingSphere.radius += authoredTreeWindMargin(part.height) * maxScale;
    }
  }, [matrices, part.height, part.geometry, part.material, capacity]);
  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, part.material, capacity]}
      count={matrices.length}
      customDepthMaterial={part.depthMaterial}
      customDistanceMaterial={part.distanceMaterial}
      castShadow
      receiveShadow
      raycast={noRaycast}
      userData={{ nfGround: true, nfAuthoredTree: { variant: part.variant, lod: part.lod } }}
    />
  );
}

export interface AuthoredTreesProps {
  scene: THREE.Object3D;
  matrices: THREE.Matrix4[];
  limit: number;
  windVec: Vector3Tuple;
  turbulence: number;
  windStrength: number;
  /** Optional scale- and quality-aware LOD thresholds. Defaults to 3x/7x authored height. */
  lodDistances?: readonly [number, number];
  /** Optional start/end fade in world metres. Omitted for the existing no-fade tree behavior. */
  fadeDistance?: readonly [number, number];
}

export function AuthoredTrees({
  scene,
  matrices,
  limit,
  windVec,
  turbulence,
  windStrength,
  lodDistances,
  fadeDistance,
}: AuthoredTreesProps) {
  const root = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const quality = useEditorStore((state) => state.renderSettings.quality ?? 'High');
  const uniforms = useRef<TreeWindUniforms>({
    uTreeTime: { value: 0 },
    uTreeWind: { value: new THREE.Vector3() },
    uTreeTurbulence: { value: 0 },
    uTreeViewerPosition: { value: new THREE.Vector3() },
    uTreeFade: { value: new THREE.Vector3() },
  });
  const meshes = useMemo(() => collectAuthoredTreeMeshes(scene), [scene]);
  const parts = useMemo(() => createPartResources(meshes, uniforms.current), [meshes]);
  useEffect(() => () => {
    for (const part of parts) {
      part.material.dispose();
      part.depthMaterial.dispose();
      part.distanceMaterial.dispose();
      if (part.ownedGeometry) part.geometry.dispose();
    }
  }, [parts]);

  const placements = useMemo(() => matrices.slice(0, Math.max(0, limit)), [matrices, limit]);
  const variants = useMemo(() => [...new Set(parts.map((part) => part.variant))].sort((a, b) => a - b), [parts]);
  const heights = useMemo(() => {
    const result = new Map<number, number>();
    for (const part of parts) result.set(part.variant, Math.max(result.get(part.variant) ?? 0, part.height));
    return result;
  }, [parts]);
  const [assignments, setAssignments] = useState<AuthoredTreeAssignment[]>([]);
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const updateFrame = useRef(0);
  const cameraPosition = useRef(new THREE.Vector3());

  const repartition = (resetHysteresis = false) => {
    if (!root.current) return;
    root.current.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraPosition.current);
    const previous = new Map<string, number>();
    if (!resetHysteresis) for (const item of assignmentsRef.current) previous.set(item.key, item.lod);
    const next = partitionAuthoredTreePlacements(
      placements,
      variants,
      heights,
      cameraPosition.current,
      root.current.matrixWorld,
      quality,
      previous,
      lodDistances,
      fadeDistance,
    );
    const current = assignmentsRef.current;
    const changed = next.length !== current.length || next.some((item, index) =>
      item.lod !== current[index]?.lod || item.variant !== current[index]?.variant || item.matrix !== current[index]?.matrix);
    if (changed) {
      assignmentsRef.current = next;
      setAssignments(next);
    }
  };

  useLayoutEffect(() => repartition(true), [placements, variants, heights, quality, camera, lodDistances, fadeDistance]);

  useFrame((frame) => {
    const state = useEditorStore.getState();
    uniforms.current.uTreeTime.value = state.isPlaying ? state.runtimeTime : frame.clock.elapsedTime;
    uniforms.current.uTreeWind.value.set(
      windVec[0] * windStrength,
      windVec[1] * windStrength,
      windVec[2] * windStrength,
    );
    uniforms.current.uTreeTurbulence.value = THREE.MathUtils.clamp(turbulence, 0, 1);
    camera.getWorldPosition(uniforms.current.uTreeViewerPosition.value);
    const validFade = fadeDistance
      && Number.isFinite(fadeDistance[0])
      && Number.isFinite(fadeDistance[1])
      && fadeDistance[0] >= 0
      && fadeDistance[1] > fadeDistance[0];
    uniforms.current.uTreeFade.value.set(
      validFade ? fadeDistance[0] : 0,
      validFade ? fadeDistance[1] : 1,
      validFade ? 1 : 0,
    );
    if (++updateFrame.current >= LOD_UPDATE_FRAMES) {
      updateFrame.current = 0;
      repartition();
    }
  });

  const partitions = useMemo(() => {
    const result = new Map<string, THREE.Matrix4[]>();
    for (const assignment of assignments) {
      const key = `${assignment.variant}:${assignment.lod}`;
      const group = result.get(key) ?? [];
      group.push(assignment.matrix);
      result.set(key, group);
    }
    return result;
  }, [assignments]);

  if (!scene.userData.featherTreeLibrary || placements.length === 0 || parts.length === 0) return null;
  return (
    <group ref={root}>
      {parts.map((part) => (
        <AuthoredTreeInstances
          key={part.id}
          part={part}
          matrices={partitions.get(`${part.variant}:${part.lod}`) ?? EMPTY_MATRICES}
          capacity={placements.length}
        />
      ))}
    </group>
  );
}
