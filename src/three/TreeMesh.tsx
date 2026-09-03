import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject, TreePixelArtSpec, TreeSpec } from '../types';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { sunDirectionFromEnvironment } from './environmentSettings';
import { generateTree } from '../tree/generateTree';
import { normalizeTreeSpec } from '../tree/treeSpec';
import { pixelCanopyTexture } from '../tree/pixelCanopy';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';
import { getTreeChopState, treeChopVersion } from '../runtime/treeChop';

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
  uWind: { value: THREE.Vector3 };
  /** World-unit sway amplitude at full weight — scaled from the spec's trunk height per tree. */
  uSwayAmplitude: { value: number };
  uSwaySpeed: { value: number };
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
    uWind: { value: new THREE.Vector3() },
    uSwayAmplitude: { value: 0.25 },
    uSwaySpeed: { value: 1 },
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
uniform vec3  uWind;
uniform float uSwayAmplitude;
uniform float uSwaySpeed;
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
      mat3 nfCardM = mat3(modelViewMatrix) * mat3(instanceMatrix);
    #else
      mat3 nfCardM = mat3(modelViewMatrix);
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
  float nfGust = sin(nfPhase) * 0.65 + sin(nfPhase * 2.33 + 1.7) * 0.35;
  // Idle breathing even at zero wind (grass has the same baseSway); authored wind scales on top.
  float nfAmp = uSwayAmplitude * (0.3 + min(nfWindMag, 2.5) * 0.7);
  vec2 nfLean = nfWindDir * nfAmp * nfGust * aWind;
  transformed.x += nfLean.x;
  transformed.z += nfLean.y;
  // A weaker cross-wind figure-eight keeps limbs from tracing one straight line back and forth.
  transformed.xz += vec2(-nfWindDir.y, nfWindDir.x) * sin(nfPhase * 3.1 + aTrunkT * 9.3) * aWind * nfAmp * 0.22;
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
  pixelArt?: TreePixelArtSpec,
): THREE.MeshLambertMaterial {
  const paintedCards = kind === 'foliage' && pixelArt?.enabled;
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: paintedCards ? pixelCanopyTexture() : null,
    alphaTest: paintedCards ? pixelArt.alphaCutoff : 0,
    side: kind === 'foliage' ? THREE.DoubleSide : THREE.FrontSide,
    // Foliage normals are baked radial/canopy blends from the generator; flat shading would throw
    // them away and re-derive hard facet normals — the old "plastic rock pile" look.
    flatShading: false,
  });
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
  material.customProgramCacheKey = () => `nf-tree-${kind}-v3-${paintedCards ? 'pixel' : 'solid'}`;
  return material;
}

const pixelMaterialKey = (spec: TreeSpec | null): string => {
  const pixel = spec?.look.pixelArt;
  return pixel?.enabled ? `on:${pixel.alphaCutoff}` : 'off';
};

/** Per-frame uniform update shared by single trees and scattered forests. */
function updateTreeUniforms(
  u: TreeUniforms,
  delta: number,
  windVec: readonly number[],
  env: ReturnType<typeof selectActiveSceneEnvironment>,
  camera: THREE.Camera,
  spec: TreeSpec | null,
): void {
  u.uTime.value += Math.min(delta, 1 / 20);
  u.uWind.value.set(windVec[0], 0, windVec[2]);
  const windMag = Math.hypot(windVec[0], windVec[2]);
  // Amplitude scales with the tree, not a constant: a 15-unit spruce leans farther than a shrub.
  const height = spec?.trunk.height ?? 7;
  u.uSwayAmplitude.value = THREE.MathUtils.clamp(height * 0.045, 0.05, 0.65);
  u.uSwaySpeed.value = 1 + windMag * 0.55;
  u.uInteractorCount.value = foliageInteractorUniforms.uInteractorCount.value;
  if (env) u.uSunDirView.value.copy(sunDirectionFromEnvironment(env));
  else u.uSunDirView.value.set(0.35, 0.75, 0.4).normalize();
  u.uSunDirView.value.transformDirection(camera.matrixWorldInverse);
  if (spec) {
    u.uTransColor.value.set(spec.look.translucency.color);
    u.uTransScale.value = spec.look.translucency.scale;
    u.uTransPower.value = spec.look.translucency.power;
  }
}

/** The standing part of a tree (or the whole tree when it has not been felled). */
export function TreeMesh({ object }: { object: SceneObject }) {
  const tree = object.tree;
  const env = useEditorStore(selectActiveSceneEnvironment);
  // Re-read when a chop lands. The chop bus bumps a version rather than living in the store, so felling
  // never triggers a scene-wide React re-render.
  const chopVersion = treeChopVersion();
  const windVec = env?.wind ?? [0, 0, 0];

  const spec = useMemo(() => (tree ? normalizeTreeSpec(tree.spec) : null), [tree]);
  const generated = useMemo(() => (spec ? generateTree(spec, tree?.seed ?? 1) : null), [spec, tree?.seed]);

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const barkMaterial = useMemo(() => makeTreeMaterial('bark', uniforms.current), []);
  const paintedMaterialKey = pixelMaterialKey(spec);
  const foliageMaterial = useMemo(
    () => makeTreeMaterial('foliage', uniforms.current, spec?.look.pixelArt),
    // Leaf-art choice lives in geometry UVs; only enablement/cutoff changes the material program.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paintedMaterialKey],
  );

  // generateTree builds fresh geometry per spec/seed and makeTreeMaterial a fresh material per
  // instance, both imperatively, so nothing else frees them. Editing a tree in the inspector rebuilds
  // them on every change and abandoned the previous set each time.
  useEffect(() => {
    if (!generated) return;
    return () => {
      generated.bark.dispose();
      generated.foliage?.dispose();
    };
  }, [generated]);
  useEffect(() => () => barkMaterial.dispose(), [barkMaterial]);
  useEffect(() => () => foliageMaterial.dispose(), [foliageMaterial]);

  useFrame((state, delta) => {
    const u = uniforms.current;
    updateTreeUniforms(u, delta, windVec, env, state.camera, spec);
    // Per-instance tint: a stand of one spec still varies leaf hue/value tree to tree.
    // 0.5 is the NEUTRAL value — an unjittered tree must render its authored colors exactly.
    const jitter = tree?.tintJitter ?? 0.5;
    foliageMaterial.color.setRGB(1, 1, 1).offsetHSL((jitter - 0.5) * 0.05, 0, (jitter - 0.5) * 0.08);
    const chop = getTreeChopState(object.id);
    const severedIndex = chop?.severedAt;
    if (severedIndex !== undefined && spec) {
      u.uSever.value.set(spec.chop.breakPoints[severedIndex]?.height ?? 1, 0, 1);
    } else {
      u.uSever.value.set(1, 0, 0);
    }
  });

  if (!tree?.enabled || !generated) return null;
  // chopVersion is read so the memo above re-evaluates on a chop; referencing it keeps the lint honest.
  void chopVersion;

  return (
    <group>
      <mesh geometry={generated.bark} material={barkMaterial} castShadow receiveShadow />
      {generated.foliage && <mesh geometry={generated.foliage} material={foliageMaterial} castShadow receiveShadow />}
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
}: {
  spec: TreeSpec;
  matrices: THREE.Matrix4[];
  seedVariants?: number;
}) {
  const normalized = useMemo(() => normalizeTreeSpec(spec), [spec]);
  const variants = useMemo(
    () => Array.from({ length: seedVariants }, (_, i) => generateTree(normalized, 1013 + i * 7717)),
    [normalized, seedVariants],
  );
  // Split the placements round-robin so each variant gets a roughly even share.
  const buckets = useMemo(() => {
    const out: THREE.Matrix4[][] = Array.from({ length: seedVariants }, () => []);
    matrices.forEach((m, i) => out[i % seedVariants].push(m));
    return out;
  }, [matrices, seedVariants]);

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const barkMaterial = useMemo(() => makeTreeMaterial('bark', uniforms.current), []);
  const paintedMaterialKey = pixelMaterialKey(normalized);
  const foliageMaterial = useMemo(
    () => makeTreeMaterial('foliage', uniforms.current, normalized.look.pixelArt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paintedMaterialKey],
  );
  // One geometry pair per seed variant, rebuilt whenever the spec or variant count changes.
  useEffect(
    () => () => {
      for (const variant of variants) {
        variant.bark.dispose();
        variant.foliage?.dispose();
      }
    },
    [variants],
  );
  useEffect(() => () => barkMaterial.dispose(), [barkMaterial]);
  useEffect(() => () => foliageMaterial.dispose(), [foliageMaterial]);

  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];

  useFrame((state, delta) => {
    const u = uniforms.current;
    updateTreeUniforms(u, delta, windVec, env, state.camera, normalized);
    // Scattered trees are scenery — they are never individually felled, so the sever uniform stays off.
    u.uSever.value.set(1, 0, 0);
  });

  if (matrices.length === 0) return null;
  return (
    <>
      {variants.map((variant, i) =>
        buckets[i].length === 0 ? null : (
          <group key={i}>
            <TreeInstances geometry={variant.bark} material={barkMaterial} matrices={buckets[i]} />
            {variant.foliage && <TreeInstances geometry={variant.foliage} material={foliageMaterial} matrices={buckets[i]} />}
          </group>
        ),
      )}
    </>
  );
}

function TreeInstances({
  geometry,
  material,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
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
      castShadow
      receiveShadow
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true }}
    />
  );
}
