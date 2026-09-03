import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vector3Tuple } from '../types';
import { useAssetTexture } from './ModelAsset';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';

/** Foliage is decorative — never let it catch pointer rays (it would block terrain sculpt/paint). */
const ignoreFoliageRaycast = () => null;

/** Neutral fallback for any wildflower instance missing a color (keeps that bloom the material's base tint). */
const WHITE = new THREE.Color(1, 1, 1);

// --- Geometry builders (base at y=0, uv.y 0=base → 1=tip, so the wind shader bends the tip) ---------

/**
 * A soft, ARCHING grass blade — a chunky tapered strip that curves forward and droops toward the tip so a
 * field of them (each at a random yaw) reads as a lush combed meadow, not a bed of stiff spikes. Five rows
 * give a smooth curve; the blade keeps its width through the body and tapers to a point only near the top.
 * uv.y runs 0 (base) → 1 (tip) to drive the shader gradient + tip-weighted wind/interaction bend. The
 * built-in forward curve (local +Z) is what sells the soft, natural look the reference images have.
 */
function buildBladeGeometry(width = 0.16, height = 0.78): THREE.BufferGeometry {
  const hw = width / 2;
  // [heightFrac, halfWidthFrac, forwardCurveFrac] — arches forward (droops) as it rises.
  const rows: Array<[number, number, number]> = [
    [0.0, 1.0, 0.0],
    [0.3, 0.92, 0.02],
    [0.55, 0.78, 0.08],
    [0.78, 0.55, 0.2],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  for (const [t, f, curve] of rows) {
    const y = t * height;
    const w = hw * f;
    const z = curve * height;
    positions.push(-w, y, z, w, y, z);
    uvs.push(0, t, 1, t);
    normals.push(0, 0, 1, 0, 0, 1);
  }
  // Apex — curved forward the most, giving the blade its droop.
  positions.push(0, height, 0.32 * height);
  uvs.push(0.5, 1);
  normals.push(0, 0, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  // rows 0..3 → verts 0..7; apex → vert 8. Three quads up the body, a triangle to the tip.
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 7, 4, 7, 6, 6, 7, 8]);
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
// A matte MeshLambertMaterial patched (onBeforeCompile) to sway with the GLOBAL scene wind. Per-instance phase
// (from world position) desyncs the blades; the world wind is rotated into each instance's local frame so
// random per-blade yaw still bends the right way. The tip bends quadratically (uv.y²) so the base stays
// planted. A vertical color gradient darkens the base for the classic AAA grass look.
interface WindUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uWindStrength: { value: number };
  uSwaySpeed: { value: number };
  uBaseSway: { value: number };
  /** Per-material scale on the shared player/actor interaction push (0 = no reaction to actors). */
  uInteractScale: { value: number };
  /** 0 = grass mode (part sideways + press flat under the actor); 1 = tree mode (lean the canopy away
   *  from the actor with the trunk planted, no downward press — brushing past a tree). */
  uInteractMode: { value: number };
  /** 0 = tip-weighted bend (blades/billboards, base planted via uv.y²); 1 = rigid whole-instance sway
   *  (the built-in 3D tree crown — a sphere/cone has no height-mapped UVs, so it translates as one soft
   *  blob atop its static trunk). */
  uRigid: { value: number };
  /** Blends the shading normal toward world-up, so a field of blades reads as one soft turf volume
   *  (BOTW-style) instead of a scatter of hard-lit cards. 0 = raw geometric normals (legacy look). */
  uNormalLift: { value: number };
  /** Flat self-lit floor: adds this fraction of the blade's own albedo as emissive, so a double-sided
   *  blade stays a bright uniform cartoon color no matter which face (front/back) shows — kills the dark
   *  back-faces of a LIT blade field. Grass ~0.55 (near-unlit like the reference); trees 0 (keep volume). */
  uEmit: { value: number };
}

function makeWindMaterial(
  color: string,
  map: THREE.Texture | undefined,
  alphaTest: number,
  uniforms: WindUniforms,
): THREE.MeshLambertMaterial {
  // Lambert, NOT Standard: foliage must be pure matte diffuse. The PBR specular + IBL reflection of a
  // MeshStandardMaterial puts a broad plasticky sheen across the blades that reads as wet rubber — the
  // #1 "why does my grass look like rubber" cause. Lambert still takes the sun, ambient/hemisphere fill,
  // shadows and fog, so the field stays lit and grounded, just without the sheen. (Both reference engines
  // go fully unlit; Lambert keeps scene-lighting response, which is a touch nicer for day/night.)
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color),
    map: map ?? null,
    side: THREE.DoubleSide,
    alphaTest,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uSwaySpeed = uniforms.uSwaySpeed;
    shader.uniforms.uBaseSway = uniforms.uBaseSway;
    shader.uniforms.uInteractScale = uniforms.uInteractScale;
    shader.uniforms.uInteractMode = uniforms.uInteractMode;
    shader.uniforms.uRigid = uniforms.uRigid;
    shader.uniforms.uNormalLift = uniforms.uNormalLift;
    shader.uniforms.uEmit = uniforms.uEmit;
    // Shared, updated-in-place by the runtime tick — every foliage material sees the same actor list.
    shader.uniforms.uInteractors = foliageInteractorUniforms.uInteractors;
    shader.uniforms.uInteractorCount = foliageInteractorUniforms.uInteractorCount;
    shader.vertexShader =
      `uniform float uTime; uniform vec3 uWind; uniform float uWindStrength; uniform float uSwaySpeed; uniform float uBaseSway;
       uniform float uInteractScale; uniform float uInteractMode; uniform float uRigid; uniform float uNormalLift;
       uniform vec4 uInteractors[${MAX_FOLIAGE_INTERACTORS}]; uniform int uInteractorCount; varying float vNfH; varying vec3 vNfTint; varying vec3 vNfInstColor; varying float vNfGust; varying float vNfPatch; varying float vNfRigid;\n` +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
        // Soft "turf volume" shading: tilt the blade normal toward the sky so the whole field lights as
        // one rounded mass rather than a thicket of hard-edged cards (Tier 7.3 foliage volume normals).
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), clamp(uNormalLift, 0.0, 1.0)));`,
        )
        .replace(
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
        // Per-instance color variation from world position — breaks up the "one flat green" look so a
        // field reads as natural, varied vegetation (BOTW-style). Subtle: ±~10% brightness + a faint hue shift.
        float nfVar = fract(sin(dot(nfWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // When a per-instance color is present (ground-borrowed grass tints / wildflowers) the CPU color is
        // the source of truth — skip the shader green-bias so the "melt into the turf" color survives.
        #ifdef USE_INSTANCING_COLOR
          vNfTint = vec3(1.0);
        #else
          vNfTint = mix(vec3(0.84, 0.92, 0.80), vec3(1.03, 1.10, 0.97), nfVar);
        #endif
        // Big soft rolling meadow patches (low-freq world noise) — the trick that makes a distant field read
        // as ORGANIC light/dark ground instead of one flat uniform green slab.
        vNfPatch = clamp(0.5
          + 0.35 * sin(nfWorld.x * 0.09 + 1.7) * sin(nfWorld.z * 0.13 + 4.2)
          + 0.15 * sin(nfWorld.x * 0.27 + nfWorld.z * 0.24 + uTime * 0.3), 0.0, 1.0);
        // Per-instance color (wildflowers set instanceColor per bloom); grass leaves it white → no change.
        #ifdef USE_INSTANCING_COLOR
          vNfInstColor = instanceColor;
        #else
          vNfInstColor = vec3(1.0);
        #endif
        float nfT = uTime * uSwaySpeed + nfWorld.x * 0.5 + nfWorld.z * 0.5;
        // Travelling gust band: a wave rolling across the field ALONG the wind direction — you can SEE the
        // wind sweep the grass (Zelda/BOTW "wind lines"). It swells the lean where it passes and brightens
        // the tips (vNfGust → fragment). Gated by wind magnitude so a calm scene shows no phantom sheen.
        vec2 nfWindDir = length(uWind.xz) > 0.0001 ? normalize(uWind.xz) : vec2(1.0, 0.0);
        float nfWindMag = clamp(length(uWind.xz) * 0.25, 0.0, 1.0);
        float nfBand = max(0.0, sin(dot(nfWorld.xz, nfWindDir) * 0.35 - uTime * 2.4));
        nfBand *= nfBand;
        vNfGust = nfBand * nfWindMag;
        float nfGust = 0.55 + 0.35 * sin(nfT * 1.7 + 1.3) + nfBand * 1.1; // idle flutter + travelling gust swell
        vec2 nfLean = nfLocalWind.xz * uWindStrength * nfGust;
        vec2 nfFlutter = vec2(sin(nfT), cos(nfT * 1.3)) * uBaseSway;
        // Tip-weighted for blades (base planted); rigid = whole instance moves together (tree crown blob).
        float nfAmt = mix(nfH * nfH, 1.0, uRigid);
        vNfRigid = uRigid;
        transformed.x += (nfLean.x + nfFlutter.x) * nfAmt;
        transformed.z += (nfLean.y + nfFlutter.y) * nfAmt;
        // --- Player/actor interaction: part sideways and press down under each nearby actor (BOTW) ---
        for (int nfI = 0; nfI < ${MAX_FOLIAGE_INTERACTORS}; nfI++) {
          if (nfI >= uInteractorCount) break;
          vec4 nfAct = uInteractors[nfI];
          if (nfAct.w <= 0.0001) continue;
          vec2 nfDelta = nfWorld.xz - nfAct.xz;
          float nfDist = length(nfDelta);
          if (nfDist >= nfAct.w) continue;
          float nfInfl = 1.0 - smoothstep(0.0, nfAct.w, nfDist);
          nfInfl *= nfInfl;
          vec2 nfDir = nfDist > 0.0001 ? nfDelta / nfDist : vec2(1.0, 0.0);
          #ifdef USE_INSTANCING
            vec3 nfLocalPush = transpose(nfRot) * vec3(nfDir.x, 0.0, nfDir.y);
          #else
            vec3 nfLocalPush = vec3(nfDir.x, 0.0, nfDir.y);
          #endif
          float nfPush = nfInfl * uInteractScale * nfAmt;
          transformed.x += nfLocalPush.x * nfPush * 0.6;
          transformed.z += nfLocalPush.z * nfPush * 0.6;
          // Grass presses flat under the actor; trees (mode 1) only lean, trunk planted.
          transformed.y -= nfInfl * uInteractScale * nfAmt * 0.5 * (1.0 - uInteractMode);
        }`,
      );
    shader.fragmentShader =
      'uniform float uEmit; varying float vNfH; varying vec3 vNfTint; varying vec3 vNfInstColor; varying float vNfGust; varying float vNfPatch; varying float vNfRigid;\n' +
      shader.fragmentShader
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        // Flat self-lit floor of the blade's own color — keeps grass bright and uniform whichever face
        // (front/back of the double-sided blade) is showing, so it reads near-unlit like the reference.
        totalEmissiveRadiance += diffuseColor.rgb * uEmit;`,
        )
        .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Root→tip shape via a smoothstep ramp (darkened root = contact AO, brighter tip), the per-blade
        // green variation, and per-instance color (wildflowers). Grass gets a punchy ramp; tree crowns
        // (rigid) get a GENTLE one so the stacked fir tiers read as one soft mass, not hard bands.
        float nfGrad = vNfH * vNfH * (3.0 - 2.0 * vNfH);
        float nfLo = mix(0.72, 0.82, vNfRigid);
        float nfHi = mix(1.14, 1.04, vNfRigid);
        diffuseColor.rgb *= mix(nfLo, nfHi, nfGrad) * vNfTint * vNfInstColor;
        // Rolling meadow macro-patches — organic large-scale light/dark so the far field isn't a flat slab.
        diffuseColor.rgb *= mix(0.9, 1.08, vNfPatch);
        // A whisper of sun-through-blade warmth at the tips (fake SSS) — subtle so the field stays a fresh
        // green rather than drifting lime/yellow.
        diffuseColor.rgb += vec3(0.018, 0.026, 0.008) * nfGrad * nfGrad;
        // Travelling gust sheen: tips brighten where the wind band rolls over them, so a gust reads as a
        // band of light sweeping the field (the "you can see the wind" trick), not just motion.
        diffuseColor.rgb *= 1.0 + vNfGust * 0.18 * smoothstep(0.4, 1.0, vNfH);`,
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
  normalLift = 0,
  interactStrength = 1,
  interactMode = 0,
  rigid = false,
  colors,
  shadow = true,
  emit = 0,
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
  /** Sky-ward normal blend for the soft turf/canopy look (Tier 7.3). 0 = off. */
  normalLift?: number;
  /** Multiplier on how far this foliage parts for a passing actor. 0 = ignores actors. */
  interactStrength?: number;
  /** 0 = grass (part + press flat), 1 = tree (lean away, trunk planted). */
  interactMode?: number;
  /** True = rigid whole-instance sway (built-in 3D tree crown); false = tip-weighted bend (blades). */
  rigid?: boolean;
  /** Optional per-instance colors (index-aligned with `matrices`) — used for varied wildflower blooms. */
  colors?: THREE.Color[];
  /** Cast/receive shadows. Default true (trees). Grass/flowers pass false — dense thin blades self-shadow
   *  into ugly near-black clumps ("black grass"), and their cost isn't worth it for cosmetic ground cover. */
  shadow?: boolean;
  /** Flat self-lit floor (0..1) so double-sided blades stay bright on both faces. Grass ~0.55, else 0. */
  emit?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const uniforms = useRef<WindUniforms>({
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uWindStrength: { value: 0 },
    uSwaySpeed: { value: swaySpeed },
    uBaseSway: { value: baseSway },
    uInteractScale: { value: interactStrength },
    uInteractMode: { value: interactMode },
    uRigid: { value: rigid ? 1 : 0 },
    uNormalLift: { value: normalLift },
    uEmit: { value: emit },
  });
  const material = useMemo(
    () => makeWindMaterial(color, map, alphaTest, uniforms.current),
    [color, map, alphaTest],
  );

  // Rebuilt whenever the colour, texture or cutoff changes, and built imperatively, so nothing else
  // frees the previous one. (The blade/cross GEOMETRIES are module-level singletons — never dispose.)
  useEffect(() => () => material.dispose(), [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    if (colors) {
      // setColorAt lazily allocates mesh.instanceColor → defines USE_INSTANCING_COLOR so the shader
      // picks up vNfInstColor (see makeWindMaterial). White fallback keeps any missing index neutral.
      matrices.forEach((_, index) => mesh.setColorAt(index, colors[index] ?? WHITE));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }, [matrices, colors]);

  useFrame((_, delta) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(delta, 1 / 20) * (1 + turbulence);
    u.uWind.value.set(windVec[0], 0, windVec[2]);
    // 0.03 maps a wind magnitude of ~10 to a believable tip lean; windStrength scales it per-terrain.
    u.uWindStrength.value = 0.03 * windStrength;
    u.uSwaySpeed.value = swaySpeed;
    u.uBaseSway.value = baseSway;
    u.uInteractScale.value = interactStrength;
    u.uInteractMode.value = interactMode;
    u.uRigid.value = rigid ? 1 : 0;
    u.uNormalLift.value = normalLift;
    u.uEmit.value = emit;
  });

  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, matrices.length]}
      castShadow={shadow}
      receiveShadow={shadow}
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
  normalLift,
  interactStrength,
  interactMode,
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
  normalLift?: number;
  interactStrength?: number;
  interactMode?: number;
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
      normalLift={normalLift}
      interactStrength={interactStrength}
      interactMode={interactMode}
      alphaTest={0.4}
    />
  );
}
