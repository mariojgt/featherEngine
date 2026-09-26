import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject, TreePixelArtSpec, TreeSpec } from '../types';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { sunDirectionFromEnvironment } from './environmentSettings';
import { normalizeTreeSpec, resolveTreeSpec } from '../tree/treeSpec';
import { pixelCanopyTexture } from '../tree/pixelCanopy';
import {
  naturalBarkTexture,
  naturalBirchBarkTexture,
  naturalFoliageTexture,
  naturalLeafTexture,
  naturalNeedleTexture,
} from '../tree/surfaceTextures';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';
import { getTreeChopState, treeChopVersion } from '../runtime/treeChop';
import {
  acquireTreeGeometry,
  batchTreePlacements,
  releaseTreeGeometry,
  selectTreeLod,
  type TreeGeometryLease,
} from './treeRenderResources';

/**
 * Renders one parametric tree: bark + canopy, regenerated from the object's spec + seed.
 *
 * The material is patched from MeshLambertMaterial rather than MeshStandardMaterial on purpose — the same
 * reason foliageWind.tsx gives for grass: a PBR specular lobe plus IBL puts a broad plasticky sheen over
 * foliage that reads as wet rubber.
 *
 * Two custom vertex attributes come out of the generator. This IS a new convention for this codebase (the
 * grass/foliage path encodes everything in uv.y + vertex colour), and it earns its keep:
 *   aWind    per-vertex sway weight. uv.y can't express it — a twig at the top of a level-2 branch and a
 *            point halfway up the trunk can share a uv.y yet must move completely differently.
 *   aTrunkT  the trunk height this vertex's limb is rooted at, which is what makes felling a pure vertex
 *            partition instead of a CSG operation.
 */

/** Scattered trees are scenery — they must never swallow terrain sculpt/paint clicks. */
const ignoreFoliageRaycast = () => null;

interface TreeUniforms {
  uTime: { value: number };
  uViewerViewMatrix: { value: THREE.Matrix4 };
  uWind: { value: THREE.Vector3 };
  /** World-unit sway amplitude at full weight — scaled from the spec's trunk height per tree. */
  uSwayAmplitude: { value: number };
  uSwaySpeed: { value: number };
  uTurbulence: { value: number };
  /** x = sever height in aTrunkT space, y = 1 when this draw is the FALLING half, z = 1 when severed. */
  uSever: { value: THREE.Vector3 };
  uInteractors: { value: THREE.Vector4[] };
  uInteractorCount: { value: number };
  uInteractStrength: { value: number };
  /** Direction TOWARD the sun, in view space — drives leaf translucency. */
  uSunDirView: { value: THREE.Vector3 };
  uTransColor: { value: THREE.Color };
  uTransScale: { value: number };
  uTransPower: { value: number };
  uRimStrength: { value: number };
}

function makeTreeUniforms(): TreeUniforms {
  return {
    uTime: { value: 0 },
    uViewerViewMatrix: { value: new THREE.Matrix4() },
    uWind: { value: new THREE.Vector3() },
    uSwayAmplitude: { value: 0.25 },
    uSwaySpeed: { value: 1 },
    uTurbulence: { value: 1 },
    uSever: { value: new THREE.Vector3(1, 0, 0) },
    uInteractors: foliageInteractorUniforms.uInteractors,
    uInteractorCount: foliageInteractorUniforms.uInteractorCount,
    uInteractStrength: { value: 1 },
    uSunDirView: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
    uTransColor: { value: new THREE.Color('#9ed070') },
    uTransScale: { value: 0.55 },
    uTransPower: { value: 2.4 },
    uRimStrength: { value: 0.16 },
  };
}

const VERTEX_HEAD = `
attribute float aWind;
attribute float aTrunkT;
attribute vec3  aCardDelta;
attribute vec2  aCardOffset;
uniform float uTime;
uniform mat4 uViewerViewMatrix;
uniform vec3  uWind;
uniform float uSwayAmplitude;
uniform float uSwaySpeed;
uniform float uTurbulence;
uniform vec3  uSever;
uniform vec4  uInteractors[${MAX_FOLIAGE_INTERACTORS}];
uniform int   uInteractorCount;
uniform float uInteractStrength;
varying float vTreeCut;
`;

const VERTEX_BODY = `
  // Pixel foliage cards carry their authored corner-to-centre delta and a 2D half-offset. Rebuild
  // those cards in the camera plane so a crown never thins into edge-on splinters. Ordinary foliage
  // has zeroes in both attributes, making this an exact no-op for every existing tree.
  {
    #ifdef USE_INSTANCING
      mat3 nfCardM = mat3(uViewerViewMatrix * modelMatrix) * mat3(instanceMatrix);
    #else
      mat3 nfCardM = mat3(uViewerViewMatrix * modelMatrix);
    #endif
    float nfCardX = max(dot(nfCardM[0], nfCardM[0]), 1e-8);
    float nfCardY = max(dot(nfCardM[1], nfCardM[1]), 1e-8);
    float nfCardZ = max(dot(nfCardM[2], nfCardM[2]), 1e-8);
    vec3 nfCardRight = vec3(nfCardM[0].x / nfCardX, nfCardM[1].x / nfCardY, nfCardM[2].x / nfCardZ);
    vec3 nfCardUp = vec3(nfCardM[0].y / nfCardX, nfCardM[1].y / nfCardY, nfCardM[2].y / nfCardZ);
    nfCardRight *= inversesqrt(max(dot(nfCardRight, nfCardRight), 1e-12));
    nfCardUp *= inversesqrt(max(dot(nfCardUp, nfCardUp), 1e-12));
    transformed += aCardDelta + nfCardRight * aCardOffset.x + nfCardUp * aCardOffset.y;
  }

  // Discard-by-collapse: the standing half and the felled half are the SAME geometry drawn twice, each
  // hiding the vertices belonging to the other. Cheaper and far simpler than splitting buffers, and it
  // keeps one shared geometry for every instance of the spec.
  float nfAbove = step(uSever.x, aTrunkT);
  vTreeCut = 0.0;
  if (uSever.z > 0.5) {
    float nfMine = mix(1.0 - nfAbove, nfAbove, uSever.y);
    if (nfMine < 0.5) {
      transformed = vec3(0.0);
      vTreeCut = 1.0;
    }
  }

  // On an InstancedMesh modelMatrix is SHARED, so deriving the sway phase from it alone would make every
  // scattered tree sway in perfect unison — instantly and obviously wrong. Fold in instanceMatrix so each
  // trunk gets its own world position and therefore its own phase.
  #ifdef USE_INSTANCING
    vec3 nfWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 nfWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float nfWindMag = length(uWind.xz);
  vec2 nfWindDir = nfWindMag > 1e-4 ? uWind.xz / nfWindMag : vec2(0.8, 0.6);
  // The gust phase travels ALONG the wind, so a grove ripples in sequence instead of pulsing as one.
  float nfPhase = uTime * uSwaySpeed + dot(nfWorld.xz, nfWindDir) * 0.22 + nfWorld.z * 0.07;
  // Two frequencies so the canopy never reads as a single rocking rigid body.
  float nfGust = sin(nfPhase) * 0.65 + sin(nfPhase * (1.65 + uTurbulence * 0.68) + 1.7) * 0.35;
  // Idle breathing even at zero wind (grass has the same baseSway); authored wind scales on top.
  float nfAmp = uSwayAmplitude * (0.3 + min(nfWindMag, 2.5) * 0.7);
  vec2 nfLean = nfWindDir * nfAmp * nfGust * aWind;
  transformed.x += nfLean.x;
  transformed.z += nfLean.y;
  // A weaker cross-wind figure-eight keeps limbs from tracing one straight line back and forth.
  transformed.xz += vec2(-nfWindDir.y, nfWindDir.x) * sin(nfPhase * (2.1 + uTurbulence) + aTrunkT * 9.3) * aWind * nfAmp * 0.22;
  // Twigs also flutter across the wind, which is most of what sells foliage as light and separate.
  transformed.y += sin(nfPhase * 1.9 + aTrunkT * 6.0 + transformed.x * 0.6) * aWind * nfAmp * 0.35;

  // Actors brushing past push the canopy aside; the trunk stays planted (aWind is ~0 down there).
  for (int i = 0; i < ${MAX_FOLIAGE_INTERACTORS}; i++) {
    if (i >= uInteractorCount) break;
    vec4 nfIt = uInteractors[i];
    if (nfIt.w <= 0.0) continue;
    #ifdef USE_INSTANCING
      vec3 nfV = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz - nfIt.xyz;
    #else
      vec3 nfV = (modelMatrix * vec4(transformed, 1.0)).xyz - nfIt.xyz;
    #endif
    float nfD = length(nfV.xz);
    float nfInfl = 1.0 - smoothstep(nfIt.w * 0.4, nfIt.w, nfD);
    if (nfInfl <= 0.0) continue;
    vec2 nfAway = nfD > 1e-4 ? nfV.xz / nfD : vec2(1.0, 0.0);
    transformed.xz += nfAway * nfInfl * uInteractStrength * aWind * 0.35;
  }
`;

const FRAGMENT_HEAD = 'varying float vTreeCut;\n';
// Collapsed vertices land on the origin as degenerate triangles, but a stray interpolated fragment can
// still slip through; discarding them outright is cheaper than reasoning about it.
const FRAGMENT_BODY = `  if (vTreeCut > 0.5) discard;`;

const FOLIAGE_FRAGMENT_HEAD = `
uniform vec3  uSunDirView;
uniform vec3  uTransColor;
uniform float uTransScale;
uniform float uTransPower;
uniform float uRimStrength;
`;

/**
 * The two view-dependent terms that make foliage read as leaves rather than painted plastic —
 * injected after <emissivemap_fragment>, where both the shading normal and vViewPosition exist:
 *   translucency  sun bleeding THROUGH the canopy when you look toward it (spec.look.translucency)
 *   rim           a soft self-coloured edge light lifting the silhouette off the background
 */
const FOLIAGE_FRAGMENT_BODY = `
  {
    vec3 nfN = normalize(normal);
    vec3 nfV = normalize(vViewPosition);
    float nfBack = pow(saturate(dot(nfV, -uSunDirView)), uTransPower);
    float nfFace = saturate(dot(nfN, uSunDirView) * -0.35 + 0.65);
    totalEmissiveRadiance += uTransColor * mix(vec3(1.0), diffuseColor.rgb * 1.6, 0.45) * (nfBack * nfFace * 1.6) * uTransScale;
    float nfRim = pow(1.0 - saturate(dot(nfV, nfN)), 3.0);
    totalEmissiveRadiance += diffuseColor.rgb * nfRim * uRimStrength;
  }
`;

function makeTreeMaterial(
  kind: 'bark' | 'foliage',
  uniforms: TreeUniforms,
  spec: TreeSpec,
): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const pixelArt: TreePixelArtSpec = spec.look.pixelArt;
  const paintedCards = kind === 'foliage' && pixelArt.enabled;
  const individualLeaves = kind === 'foliage' && spec.foliage.strategy === 'leaves' && !paintedCards;
  const natural = spec.look.surface.style === 'natural' && !paintedCards;
  const naturalBirchBark = natural && kind === 'bark' && spec.foliage.strategy === 'leaves' && spec.archetype === 'birch';
  const map = paintedCards
    ? pixelCanopyTexture()
    : individualLeaves
      ? spec.archetype === 'conifer'
        ? naturalNeedleTexture()
        : naturalLeafTexture()
      : natural
      ? kind === 'bark'
        ? naturalBirchBark
          ? naturalBirchBarkTexture()
          : naturalBarkTexture()
        : naturalFoliageTexture()
      : null;
  const alphaTest = paintedCards
    ? pixelArt.alphaCutoff
    : individualLeaves || (natural && kind === 'foliage')
      ? spec.look.surface.alphaCutoff
      : 0;
  const parameters: THREE.MeshLambertMaterialParameters & THREE.MeshStandardMaterialParameters = {
    vertexColors: true,
    map,
    alphaTest,
    side: kind === 'foliage' ? THREE.DoubleSide : THREE.FrontSide,
    // Foliage normals are baked radial/canopy blends from the generator; flat shading would throw
    // them away and re-derive hard facet normals — the old "plastic rock pile" look.
    flatShading: false,
    // Keep legacy cutouts byte-for-byte in the old material path; multisample smoothing is opt-in
    // with the new small-leaf strategy only.
    alphaToCoverage: individualLeaves,
    dithering: individualLeaves,
  };
  const material = natural
    ? new THREE.MeshStandardMaterial({
        ...parameters,
        metalness: 0,
        bumpMap: kind === 'bark'
          ? naturalBirchBark
            ? naturalBirchBarkTexture()
            : naturalBarkTexture()
          : null,
        bumpScale: kind === 'bark' ? 0.045 : 0,
        roughness: kind === 'bark' ? spec.look.surface.barkRoughness : spec.look.surface.foliageRoughness,
      })
    : new THREE.MeshLambertMaterial(parameters);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    const fragmentHead = FRAGMENT_HEAD + (kind === 'foliage' ? FOLIAGE_FRAGMENT_HEAD : '');
    let fragment = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_BODY}`);
    if (kind === 'foliage') {
      fragment = fragment.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FOLIAGE_FRAGMENT_BODY}`);
    }
    shader.fragmentShader = fragmentHead + fragment;
  };
  // Must distinguish the variants or three reuses one compiled program for both.
  material.customProgramCacheKey = () =>
    `nf-tree-${kind}-v6-${paintedCards ? 'pixel' : individualLeaves ? spec.archetype === 'conifer' ? 'needles' : 'leaves' : natural ? 'natural' : 'solid'}`;
  return material;
}

function makeTreeShadowMaterial(
  kind: 'bark' | 'foliage',
  uniforms: TreeUniforms,
  spec: TreeSpec,
  distance: boolean,
): THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial {
  const paintedCards = kind === 'foliage' && spec.look.pixelArt.enabled;
  const individualLeaves = kind === 'foliage' && spec.foliage.strategy === 'leaves' && !paintedCards;
  const naturalLeaves = kind === 'foliage' && spec.look.surface.style === 'natural' && !paintedCards;
  const map = paintedCards
    ? pixelCanopyTexture()
    : individualLeaves
      ? spec.archetype === 'conifer'
        ? naturalNeedleTexture()
        : naturalLeafTexture()
      : naturalLeaves
        ? naturalFoliageTexture()
        : null;
  const alphaTest = paintedCards
    ? spec.look.pixelArt.alphaCutoff
    : individualLeaves || naturalLeaves
      ? spec.look.surface.alphaCutoff
      : 0;
  const material = distance
    ? new THREE.MeshDistanceMaterial({ map, alphaTest, side: kind === 'foliage' ? THREE.DoubleSide : THREE.FrontSide })
    : new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map,
        alphaTest,
        side: kind === 'foliage' ? THREE.DoubleSide : THREE.FrontSide,
      });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`,
    );
  };
  material.customProgramCacheKey = () =>
    `nf-tree-shadow-${kind}-v4-${distance ? 'distance' : 'depth'}-${paintedCards ? 'pixel' : individualLeaves ? spec.archetype === 'conifer' ? 'needles' : 'leaves' : naturalLeaves ? 'natural' : 'solid'}`;
  return material;
}

const treeMaterialKey = (spec: TreeSpec | null): string => {
  if (!spec) return 'none';
  const pixel = spec.look.pixelArt;
  const surface = spec.look.surface;
  return `${spec.archetype}:${spec.foliage.strategy}:${pixel.enabled}:${pixel.alphaCutoff}:${surface.style}:${surface.alphaCutoff}:${surface.barkRoughness}:${surface.foliageRoughness}`;
};

/** Per-frame uniform update shared by single trees and scattered forests. */
function updateTreeUniforms(
  u: TreeUniforms,
  _delta: number,
  windVec: readonly number[],
  env: ReturnType<typeof selectActiveSceneEnvironment>,
  camera: THREE.Camera,
  spec: TreeSpec | null,
  options: { windStrength?: number; interactStrength?: number; turbulence?: number } = {},
): void {
  const state = useEditorStore.getState();
  u.uTime.value = state.isPlaying ? state.runtimeTime : performance.now() / 1000;
  u.uViewerViewMatrix.value.copy(camera.matrixWorldInverse);
  const windStrength = options.windStrength ?? 1;
  u.uWind.value.set(windVec[0] * windStrength, 0, windVec[2] * windStrength);
  const windMag = Math.hypot(windVec[0], windVec[2]) * windStrength;
  // Amplitude scales with the tree, not a constant: a 15-unit spruce leans farther than a shrub.
  const height = spec?.trunk.height ?? 7;
  u.uSwayAmplitude.value = THREE.MathUtils.clamp(height * 0.045, 0.05, 0.65);
  u.uSwaySpeed.value = 1 + windMag * 0.55;
  u.uTurbulence.value = THREE.MathUtils.clamp(options.turbulence ?? 1, 0, 3);
  u.uInteractStrength.value = THREE.MathUtils.clamp(options.interactStrength ?? 1, 0, 3);
  u.uInteractorCount.value = foliageInteractorUniforms.uInteractorCount.value;
  if (env) u.uSunDirView.value.copy(sunDirectionFromEnvironment(env));
  else u.uSunDirView.value.set(0.35, 0.75, 0.4).normalize();
  u.uSunDirView.value.transformDirection(camera.matrixWorldInverse);
  if (spec) {
    u.uTransColor.value.set(spec.look.translucency.color);
    u.uTransScale.value = spec.look.translucency.scale * (spec.look.surface.style === 'natural' ? Math.max(0, env?.sunIntensity ?? 1) : 1);
    u.uRimStrength.value = spec.look.surface.style === 'natural' ? 0 : 0.16;
    u.uTransPower.value = spec.look.translucency.power;
  }
}

/** The standing part of a tree (or the whole tree when it has not been felled). */
export function TreeMesh({ object }: { object: SceneObject }) {
  const tree = object.tree;
  const env = useEditorStore(selectActiveSceneEnvironment);
  const treeSpecs = useEditorStore((state) => state.treeSpecs);
  // Re-read when a chop lands. The chop bus bumps a version rather than living in the store, so felling
  // never triggers a scene-wide React re-render.
  const chopVersion = treeChopVersion();
  const windVec = env?.wind ?? [0, 0, 0];

  const spec = useMemo(
    () => (tree ? normalizeTreeSpec(resolveTreeSpec(tree, treeSpecs)) : null),
    [tree, treeSpecs],
  );
  const [leases, setLeases] = useState<TreeGeometryLease[]>([]);
  useLayoutEffect(() => {
    const next = spec ? Array.from({ length: spec.lod.levels + 1 }, (_, lod) => acquireTreeGeometry(spec, tree?.seed ?? 1, lod)) : [];
    setLeases(next);
    return () => next.forEach(releaseTreeGeometry);
  }, [spec, tree?.seed]);

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const materials = useTreeMaterials(spec, uniforms.current);
  const rootRef = useRef<THREE.Group>(null);
  const lodRefs = useRef<Array<THREE.Group | null>>([]);
  const currentLod = useRef(0);

  useFrame((state, delta) => {
    const u = uniforms.current;
    updateTreeUniforms(u, delta, windVec, env, state.camera, spec);
    // Per-instance tint: a stand of one spec still varies leaf hue/value tree to tree.
    // 0.5 is the NEUTRAL value — an unjittered tree must render its authored colors exactly.
    const jitter = tree?.tintJitter ?? 0.5;
    materials?.foliage.color.setRGB(1, 1, 1).offsetHSL((jitter - 0.5) * 0.05, 0, (jitter - 0.5) * 0.08);
    const chop = getTreeChopState(object.id);
    const severedIndex = chop?.severedAt;
    if (severedIndex !== undefined && spec) {
      u.uSever.value.set(spec.chop.breakPoints[severedIndex]?.height ?? 1, 0, 1);
    } else {
      u.uSever.value.set(1, 0, 0);
    }
    if (rootRef.current && spec) {
      const distance = rootRef.current.getWorldPosition(TREE_WORLD_POSITION).distanceTo(state.camera.position);
      const scale = rootRef.current.getWorldScale(TREE_WORLD_SCALE);
      const quality = useEditorStore.getState().renderSettings.quality;
      const qualityScale = quality === 'Low' ? 0.65 : quality === 'Medium' ? 0.85 : quality === 'Epic' ? 1.25 : 1;
      const lod = selectTreeLod(distance, spec, currentLod.current, Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)), qualityScale);
      currentLod.current = lod;
      lodRefs.current.forEach((group, index) => {
        if (group) group.visible = index === lod;
      });
    }
  });

  if (!tree?.enabled || !spec || !materials || leases.length === 0) return null;
  // chopVersion is read so the memo above re-evaluates on a chop; referencing it keeps the lint honest.
  void chopVersion;

  return (
    <group ref={rootRef}>
      {leases.map((lease, lod) => (
        <group key={lease.key} ref={(node) => { lodRefs.current[lod] = node; }} visible={lod === 0}>
          <TreeGeometryMeshes tree={lease.tree} materials={materials} />
        </group>
      ))}
    </group>
  );
}

/**
 * Terrain-scattered parametric trees: one InstancedMesh per seed variant, so a forest of hundreds is a
 * handful of draw calls rather than one per tree.
 *
 * A few seeds is all it takes — every instance also gets a random yaw and scale from its matrix, so the
 * repetition never reads.
 */
export function ScatteredTrees({
  spec,
  matrices,
  seedVariants = 4,
  windStrength = 1,
  interactStrength = 1,
  turbulence = 1,
  batchCellSize = 32,
}: {
  spec: TreeSpec;
  matrices: THREE.Matrix4[];
  seedVariants?: number;
  windStrength?: number;
  interactStrength?: number;
  turbulence?: number;
  batchCellSize?: number;
}) {
  const normalized = useMemo(() => normalizeTreeSpec(spec), [spec]);
  const variantCount = Math.max(1, Math.trunc(seedVariants));
  const seeds = useMemo(() => Array.from({ length: variantCount }, (_, i) => 1013 + i * 7717), [variantCount]);
  const [variants, setVariants] = useState<TreeGeometryLease[][]>([]);
  useLayoutEffect(() => {
    const next = seeds.map((seed) => Array.from({ length: normalized.lod.levels + 1 }, (_, lod) => acquireTreeGeometry(normalized, seed, lod)));
    setVariants(next);
    return () => next.flat().forEach(releaseTreeGeometry);
  }, [normalized, seeds]);
  const batches = useMemo(
    () => batchTreePlacements(matrices, variantCount, batchCellSize),
    [matrices, variantCount, batchCellSize],
  );

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const materials = useTreeMaterials(normalized, uniforms.current);

  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];

  useFrame((state, delta) => {
    const u = uniforms.current;
    updateTreeUniforms(u, delta, windVec, env, state.camera, normalized, {
      windStrength,
      interactStrength,
      turbulence,
    });
    // Scattered trees are scenery — they are never individually felled, so the sever uniform stays off.
    u.uSever.value.set(1, 0, 0);
  });

  if (matrices.length === 0 || !materials || variants.length !== variantCount) return null;
  return (
    <>
      {batches.map((batch) => (
        <TreePlacementLod
          key={batch.key}
          leases={variants[batch.variant]}
          materials={materials}
          matrices={batch.matrices}
          spec={normalized}
        />
      ))}
    </>
  );
}

const TREE_WORLD_POSITION = new THREE.Vector3();
const TREE_WORLD_SCALE = new THREE.Vector3();

interface TreeMaterialSet {
  bark: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
  foliage: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
  barkDepth: THREE.MeshDepthMaterial;
  barkDistance: THREE.MeshDistanceMaterial;
  foliageDepth: THREE.MeshDepthMaterial;
  foliageDistance: THREE.MeshDistanceMaterial;
}

function useTreeMaterials(spec: TreeSpec | null, uniforms: TreeUniforms): TreeMaterialSet | null {
  const key = treeMaterialKey(spec);
  const materials = useMemo(() => {
    if (!spec) return null;
    return {
      bark: makeTreeMaterial('bark', uniforms, spec),
      foliage: makeTreeMaterial('foliage', uniforms, spec),
      barkDepth: makeTreeShadowMaterial('bark', uniforms, spec, false) as THREE.MeshDepthMaterial,
      barkDistance: makeTreeShadowMaterial('bark', uniforms, spec, true) as THREE.MeshDistanceMaterial,
      foliageDepth: makeTreeShadowMaterial('foliage', uniforms, spec, false) as THREE.MeshDepthMaterial,
      foliageDistance: makeTreeShadowMaterial('foliage', uniforms, spec, true) as THREE.MeshDistanceMaterial,
    };
    // `key` captures every setting that changes shader/material construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      if (!materials) return;
      Object.values(materials).forEach((material) => material.dispose());
    },
    [materials],
  );
  return materials;
}

function TreeGeometryMeshes({ tree, materials }: { tree: TreeGeometryLease['tree']; materials: TreeMaterialSet }) {
  return (
    <>
      <mesh
        geometry={tree.bark}
        material={materials.bark}
        customDepthMaterial={materials.barkDepth}
        customDistanceMaterial={materials.barkDistance}
        castShadow
        receiveShadow
      />
      {tree.foliage && (
        <mesh
          geometry={tree.foliage}
          material={materials.foliage}
          customDepthMaterial={materials.foliageDepth}
          customDistanceMaterial={materials.foliageDistance}
          castShadow
          receiveShadow
        />
      )}
    </>
  );
}

function TreePlacementLod({
  leases,
  materials,
  matrices,
  spec,
}: {
  leases: TreeGeometryLease[];
  materials: TreeMaterialSet;
  matrices: THREE.Matrix4[];
  spec: TreeSpec;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const lodRefs = useRef<Array<THREE.Group | null>>([]);
  const currentLod = useRef(0);
  const instanceScale = useMemo(() => matrices.reduce((largest, matrix) => Math.max(largest, matrix.getMaxScaleOnAxis()), 0.001), [matrices]);
  const localCenter = useMemo(() => {
    const center = new THREE.Vector3();
    const point = new THREE.Vector3();
    for (const matrix of matrices) center.add(point.setFromMatrixPosition(matrix));
    return matrices.length ? center.multiplyScalar(1 / matrices.length) : center;
  }, [matrices]);
  useFrame((state) => {
    if (!rootRef.current) return;
    const distance = rootRef.current.localToWorld(TREE_WORLD_POSITION.copy(localCenter)).distanceTo(state.camera.position);
    const scale = rootRef.current.getWorldScale(TREE_WORLD_SCALE);
    const quality = useEditorStore.getState().renderSettings.quality;
    const qualityScale = quality === 'Low' ? 0.65 : quality === 'Medium' ? 0.85 : quality === 'Epic' ? 1.25 : 1;
    const lod = selectTreeLod(distance, spec, currentLod.current, instanceScale * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)), qualityScale);
    currentLod.current = lod;
    lodRefs.current.forEach((group, index) => {
      if (group) group.visible = index === lod;
    });
  });
  return (
    <group ref={rootRef}>
      {leases.map((lease, lod) => (
        <group key={lease.key} ref={(node) => { lodRefs.current[lod] = node; }} visible={lod === 0}>
          <TreeInstances
            geometry={lease.tree.bark}
            material={materials.bark}
            depthMaterial={materials.barkDepth}
            distanceMaterial={materials.barkDistance}
            matrices={matrices}
          />
          {lease.tree.foliage && (
            <TreeInstances
              geometry={lease.tree.foliage}
              material={materials.foliage}
              depthMaterial={materials.foliageDepth}
              distanceMaterial={materials.foliageDistance}
              matrices={matrices}
            />
          )}
        </group>
      ))}
    </group>
  );
}

function TreeInstances({
  geometry,
  material,
  depthMaterial,
  distanceMaterial,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depthMaterial: THREE.MeshDepthMaterial;
  distanceMaterial: THREE.MeshDistanceMaterial;
  matrices: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // lets the forest frustum-cull as a whole
  }, [matrices]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      customDepthMaterial={depthMaterial}
      customDistanceMaterial={distanceMaterial}
      castShadow
      receiveShadow
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true }}
    />
  );
}
