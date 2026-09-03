import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StylizedGrassSettings, Vector3Tuple } from '../types';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';

/** Foliage is decorative — never let it catch pointer rays (it would block terrain sculpt/paint). */
const ignoreFoliageRaycast = () => null;

// --- Blade-card texture -------------------------------------------------------------------------------
// Stylized grass reads as PAINTED CLUMPS, not single geometric blades: one instance is a card carrying a
// dozen hand-painted strokes. We generate that card procedurally on a canvas instead of shipping a PNG so
// it works offline and under the Tauri CSP (same constraint as the desktop viewport's environment).
//
// The texture is deliberately near-greyscale: it supplies SILHOUETTE (alpha) plus per-stroke shading, and
// the shader supplies all colour (tint x gradient x variation). That is what lets one card texture serve
// every grass colour in the project.

function newCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext('2d')];
}

/**
 * Draws the clump into TWO aligned maps:
 *  - `shade`  RGB = per-stroke brightness, A = silhouette. Used as the material map, so three's depth pass
 *             inherits it and grass casts correctly cut-out shadows.
 *  - `height` R = height ALONG EACH STROKE (0 at that blade's root, 1 at its own tip).
 *
 * The second map is what makes the gradient read right: driving colour from the card's uv.y instead would
 * leave a short blade's tip stuck at 40% of the ramp, so only the few full-height blades ever reached the
 * bright tip colour and the whole field came out muddy.
 */
function buildClumpCanvases(size: number, strokes: number, seed: number): { shade: HTMLCanvasElement; height: HTMLCanvasElement } {
  const [shadeCanvas, ctx] = newCanvas(size);
  const [heightCanvas, hctx] = newCanvas(size);
  if (!ctx || !hctx) return { shade: shadeCanvas, height: heightCanvas };
  ctx.clearRect(0, 0, size, size);
  hctx.clearRect(0, 0, size, size);

  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const blades = Array.from({ length: strokes }, () => ({
    baseX: size * (0.04 + 0.92 * rnd()),
    // Bias toward SHORT blades (few tall ones poke out) so the clump is a dense mass at the base rather
    // than a handful of lone spikes — the silhouette does most of the work at a distance.
    height: size * (0.30 + 0.58 * Math.pow(rnd(), 1.6)),
    // ~1:8 width:height. Much thinner than this and blades alias into flickering hairs at any distance.
    halfW: size * (0.028 + 0.030 * rnd()),
    // Gentle sweep only. A large curve shears the stroke into a diagonal streak instead of a grass blade.
    curve: (rnd() - 0.5) * size * 0.13,
    // Darker strokes read as blades sitting deeper inside the clump. Keep the floor well above black —
    // the shader's root gradient already supplies the deep shadow.
    shade: 0.6 + 0.4 * rnd(),
  }));
  // Paint darkest (furthest back) first so bright front blades overlap them.
  blades.sort((a, b) => a.shade - b.shade);

  for (const b of blades) {
    const baseY = size;
    const tipX = b.baseX + b.curve;
    const tipY = size - b.height;
    const ctrlX = b.baseX + b.curve * 0.3;
    const ctrlY = size - b.height * 0.58;
    const trace = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      c.moveTo(b.baseX - b.halfW, baseY);
      c.quadraticCurveTo(ctrlX - b.halfW * 0.45, ctrlY, tipX, tipY);
      c.quadraticCurveTo(ctrlX + b.halfW * 0.45, ctrlY, b.baseX + b.halfW, baseY);
      c.closePath();
      c.fill();
    };
    const level = Math.round(b.shade * 255);
    ctx.fillStyle = `rgb(${level},${level},${level})`;
    trace(ctx);

    const ramp = hctx.createLinearGradient(b.baseX, baseY, tipX, tipY);
    ramp.addColorStop(0, '#000000');
    ramp.addColorStop(1, '#ffffff');
    hctx.fillStyle = ramp;
    trace(hctx);
  }
  return { shade: shadeCanvas, height: heightCanvas };
}

function makeTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

let clumpTextures: { shade: THREE.Texture; height: THREE.Texture } | null = null;

/** The shared painted-clump card. Built once, reused by every grass draw call in the project. */
export function getGrassClumpTextures(): { shade: THREE.Texture; height: THREE.Texture } {
  if (clumpTextures) return clumpTextures;
  const canvases = buildClumpCanvases(256, 28, 0x9e3779b9);
  clumpTextures = {
    shade: makeTexture(canvases.shade, THREE.SRGBColorSpace),
    // Data, not colour — must stay linear or the ramp gets gamma-bent.
    height: makeTexture(canvases.height, THREE.NoColorSpace),
  };
  return clumpTextures;
}

// --- Geometry -----------------------------------------------------------------------------------------

/**
 * A clump card: `cards` upright quads fanned around the Y axis so the painted strokes read from every
 * horizontal angle. Base sits at y=0 and uv.y runs 0 (root) -> 1 (tip), which drives both the wind bend
 * and the vertical colour gradient.
 */
function buildClumpGeometry(width: number, height: number, cards: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const hw = width / 2;
  for (let c = 0; c < cards; c += 1) {
    const angle = (c * Math.PI) / cards;
    const dx = Math.cos(angle) * hw;
    const dz = Math.sin(angle) * hw;
    const nx = -Math.sin(angle);
    const nz = Math.cos(angle);
    const base = c * 4;
    positions.push(-dx, 0, -dz, dx, 0, dz, dx, height, dz, -dx, height, -dz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

/** Shared singleton — instance matrices scale it per clump, so the geometry is built once. */
// Wider than tall: the scatter pass squashes clumps to 0.7 on X/Z, and a lawn should read as broad tufts
// rather than a picket fence of narrow cards.
export const GRASS_CLUMP_GEOMETRY = buildClumpGeometry(1.25, 0.8, 3);

// --- Shader -------------------------------------------------------------------------------------------

// Value noise shared by the vertex (wind) and fragment (colour variation) stages.
const NOISE_GLSL = `
float nfHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float nfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(nfHash12(i), nfHash12(i + vec2(1.0, 0.0)), f.x),
    mix(nfHash12(i + vec2(0.0, 1.0)), nfHash12(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
`;

export interface GrassUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uWindStrength: { value: number };
  uWindSpeed: { value: number };
  uWindNoiseScale: { value: number };
  uBaseSway: { value: number };
  uBendPivot: { value: number };
  uGradTop: { value: THREE.Color };
  uGradBottom: { value: THREE.Color };
  uGradOffset: { value: number };
  uGradContrast: { value: number };
  uNoiseLow: { value: THREE.Color };
  uNoiseHigh: { value: THREE.Color };
  uNoiseScale: { value: number };
  uNoiseStrength: { value: number };
  uNormalLift: { value: number };
  uPerspective: { value: number };
  uPerspStart: { value: number };
  uInteractors: { value: THREE.Vector4[] };
  uInteractorCount: { value: number };
  uInteractStrength: { value: number };
  uPushDown: { value: number };
  uTrailTint: { value: THREE.Color };
  uFade: { value: THREE.Vector3 };
  uBladeHeight: { value: THREE.Texture };
  uBladeGradient: { value: number };
}

function makeGrassUniforms(): GrassUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uWindStrength: { value: 0 },
    uWindSpeed: { value: 0.35 },
    uWindNoiseScale: { value: 0.06 },
    uBaseSway: { value: 0.03 },
    uBendPivot: { value: 0.25 },
    uGradTop: { value: new THREE.Color('#e9e78f') },
    uGradBottom: { value: new THREE.Color('#33304a') },
    uGradOffset: { value: 0.08 },
    uGradContrast: { value: 0.55 },
    uNoiseLow: { value: new THREE.Color('#eef1c8') },
    uNoiseHigh: { value: new THREE.Color('#8fb257') },
    uNoiseScale: { value: 0.045 },
    uNoiseStrength: { value: 0.35 },
    uNormalLift: { value: 0.75 },
    uPerspective: { value: 0.35 },
    uPerspStart: { value: 0.3 },
    // Shared module singletons: the runtime tick rewrites these in place each frame, so every foliage
    // draw call (blades, flowers, clumps) reads one consistent interactor list with zero React churn.
    uInteractors: foliageInteractorUniforms.uInteractors,
    uInteractorCount: foliageInteractorUniforms.uInteractorCount,
    uInteractStrength: { value: 0.55 },
    uPushDown: { value: 0.35 },
    uTrailTint: { value: new THREE.Color('#c9d98f') },
    uFade: { value: new THREE.Vector3(45, 70, 2) },
    uBladeHeight: { value: getGrassClumpTextures().height },
    uBladeGradient: { value: 0.8 },
  };
}

const VERTEX_HEAD = `
uniform float uTime;
uniform vec3  uWind;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uWindNoiseScale;
uniform float uBaseSway;
uniform float uBendPivot;
uniform float uPerspective;
uniform float uPerspStart;
uniform vec4  uInteractors[${MAX_FOLIAGE_INTERACTORS}];
uniform int   uInteractorCount;
uniform float uInteractStrength;
uniform float uPushDown;
uniform vec3  uFade;
varying float vNfH;
varying float vNfBend;
varying float vNfFade;
varying vec2  vNfWorldXZ;
varying vec2  vNfUv;
varying float vNfDist;
${NOISE_GLSL}
`;

const VERTEX_BODY = `
  float nfH = uv.y;
  vNfH = nfH;
  vNfUv = uv;

  // Instance frame. mat3(instanceMatrix) carries rotation AND scale; strip the scale so world-space wind
  // rotates into the blade's local frame correctly, and so a bend expressed in world units stays the same
  // physical size on a small blade and a large one.
  #ifdef USE_INSTANCING
    vec3 nfWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    mat3 nfM = mat3(instanceMatrix);
  #else
    vec3 nfWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    mat3 nfM = mat3(modelMatrix);
  #endif
  vec3 nfScale = vec3(length(nfM[0]), length(nfM[1]), length(nfM[2]));
  nfScale = max(nfScale, vec3(1e-4));
  mat3 nfBasis = mat3(nfM[0] / nfScale.x, nfM[1] / nfScale.y, nfM[2] / nfScale.z);
  mat3 nfToLocal = transpose(nfBasis);

  vNfWorldXZ = nfWorld.xz;

  // Bend mask: nothing moves below the pivot, so the clump stays rooted in the ground.
  float nfBendMask = smoothstep(uBendPivot, 1.0, nfH);

  // --- Wind: two scrolling noise layers blended, exactly the "2 noise blend" the reference uses. The
  // coarse layer is the rolling gust front; the fine layer breaks it up so the field never moves as a sheet.
  vec2 nfWindXZ = uWind.xz;
  float nfWindMag = length(nfWindXZ);
  vec2 nfWindDir = nfWindMag > 1e-4 ? nfWindXZ / nfWindMag : vec2(1.0, 0.0);
  vec2 nfFlow = nfWorld.xz * uWindNoiseScale - nfWindDir * (uTime * uWindSpeed);
  float nfCoarse = nfNoise(nfFlow);
  float nfFine = nfNoise(nfFlow * 2.7 + 13.1);
  float nfGust = mix(nfCoarse, nfCoarse * nfFine * 1.7, 0.5);
  vec3 nfLeanW = vec3(nfWindDir.x, 0.0, nfWindDir.y) * (nfWindMag * uWindStrength * (0.35 + nfGust));

  // Idle flutter so grass is never perfectly still even with zero wind.
  float nfPhase = uTime * 1.7 + nfWorld.x * 0.7 + nfWorld.z * 0.7;
  nfLeanW += vec3(sin(nfPhase), 0.0, cos(nfPhase * 1.3)) * uBaseSway;

  // --- Interaction: actors push blades away from themselves and mash them downward.
  float nfBendAmt = 0.0;
  vec3 nfPushW = vec3(0.0);
  for (int i = 0; i < ${MAX_FOLIAGE_INTERACTORS}; i++) {
    if (i >= uInteractorCount) break;
    vec4 nfIt = uInteractors[i];
    if (nfIt.w <= 0.0) continue;
    vec3 nfDelta = nfWorld - nfIt.xyz;
    float nfDist = length(nfDelta.xz);
    float nfInfl = 1.0 - smoothstep(nfIt.w * 0.3, nfIt.w, nfDist);
    // Ignore actors flying well above or below this patch of ground.
    nfInfl *= 1.0 - smoothstep(0.6, 2.4, abs(nfDelta.y));
    if (nfInfl <= 0.0) continue;
    vec2 nfAway = nfDist > 1e-4 ? nfDelta.xz / nfDist : vec2(1.0, 0.0);
    nfPushW += vec3(nfAway.x, 0.0, nfAway.y) * nfInfl;
    nfBendAmt = max(nfBendAmt, nfInfl);
  }
  vNfBend = nfBendAmt;
  nfLeanW += nfPushW * uInteractStrength;

  // --- Perspective correction: looking down at the field, upright cards shrink to slivers and the lawn
  // goes bald. Leaning the tips toward the camera as the view angle steepens keeps the coverage reading
  // full from above without touching the silhouette at eye level.
  vec3 nfToCam = cameraPosition - nfWorld;
  float nfCamDist = length(nfToCam);
  vec3 nfViewDir = nfToCam / max(nfCamDist, 1e-4);
  float nfDownness = clamp(nfViewDir.y, 0.0, 1.0);
  vec2 nfCamXZ = length(nfViewDir.xz) > 1e-4 ? normalize(nfViewDir.xz) : vec2(0.0, 1.0);
  float nfPerspMask = smoothstep(uPerspStart, 1.0, nfH);
  nfLeanW += vec3(nfCamXZ.x, 0.0, nfCamXZ.y) * (nfDownness * uPerspective * nfPerspMask);

  // Apply everything in the instance's local frame, dividing out instance scale so the bend is a world-space
  // distance rather than a fraction of each clump's size.
  vec3 nfLeanL = nfToLocal * nfLeanW;
  transformed.xz += nfLeanL.xz * nfBendMask / nfScale.xz;
  transformed.y -= nfBendAmt * uPushDown * nfH / nfScale.y;

  // --- Distance fade. 0 = off, 1 = smooth (scale the clump out), 2 = dither (screen-door discard).
  float nfFade = 1.0;
  if (uFade.z > 0.5) nfFade = 1.0 - smoothstep(uFade.x, uFade.y, nfCamDist);
  vNfFade = nfFade;
  vNfDist = nfCamDist;
  if (uFade.z > 0.5 && uFade.z < 1.5) {
    // Shrink rather than alpha-blend: 60k transparent instances would need depth sorting to look right.
    transformed.y *= nfFade;
    transformed.xz *= mix(0.35, 1.0, nfFade);
  }
`;

const FRAGMENT_HEAD = `
uniform vec3  uGradTop;
uniform vec3  uGradBottom;
uniform float uGradOffset;
uniform float uGradContrast;
uniform vec3  uNoiseLow;
uniform vec3  uNoiseHigh;
uniform float uNoiseScale;
uniform float uNoiseStrength;
uniform float uNormalLift;
uniform vec3  uTrailTint;
uniform vec3  uFade;
uniform sampler2D uBladeHeight;
uniform float uBladeGradient;
varying float vNfH;
varying float vNfBend;
varying float vNfFade;
varying vec2  vNfWorldXZ;
varying vec2  vNfUv;
varying float vNfDist;
${NOISE_GLSL}
`;

const FRAGMENT_COLOR = `
  float nfFar = smoothstep(6.0, 45.0, vNfDist);

  // Alpha-test erosion guard. Minified mips average a thin bright blade against its transparent
  // surroundings, so its alpha sinks under the cutoff and the tip is discarded — the far field loses its
  // highlights and collapses to a dark, speckled band. Raising alpha with distance lowers the effective
  // cutoff, letting distant clumps fill in as the solid bright mass they should be.
  diffuseColor.a *= 1.0 + nfFar * 1.8;

  // Root -> tip gradient, driven mostly by each BLADE's own height so every stroke gets a dark root and a
  // bright tip; the remainder comes from the card height, which darkens the bottom of the clump as a whole
  // (the ambient occlusion you'd see down between packed blades).
  float nfBladeH = texture2D(uBladeHeight, vNfUv).r;
  float nfHeight = mix(vNfH, nfBladeH, uBladeGradient);
  // Far away you look at the TOP of the canopy, not down into it, so distant grass should read as its tip
  // colour. Without this the horizon collects every blade's shadowed lower half and bands out near-black.
  nfHeight = mix(nfHeight, 1.0, nfFar * 0.55);
  float nfG = clamp((nfHeight - uGradOffset) / max(0.001, 1.0 - uGradOffset), 0.0, 1.0);
  nfG = clamp((nfG - 0.5) / max(0.05, 1.0 - uGradContrast * 0.95) + 0.5, 0.0, 1.0);
  nfG = nfG * nfG * (3.0 - 2.0 * nfG);
  diffuseColor.rgb *= mix(uGradBottom, uGradTop, nfG);

  // Large-scale colour variation so the field breaks into patches instead of reading as one flat carpet.
  // Sampled at the CLUMP ORIGIN, so a whole clump shares one tint rather than shimmering per fragment.
  float nfV = nfNoise(vNfWorldXZ * uNoiseScale) * 0.6 + nfNoise(vNfWorldXZ * uNoiseScale * 2.3 + 7.7) * 0.4;
  diffuseColor.rgb *= mix(vec3(1.0), mix(uNoiseLow, uNoiseHigh, nfV), uNoiseStrength);

  // Trail tint: blades currently mashed down by an actor shift colour, so a walked path stays readable.
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTrailTint, vNfBend);

  if (uFade.z > 1.5 && nfHash12(gl_FragCoord.xy) > vNfFade) discard;
`;

const FRAGMENT_NORMAL = `
  // Turf normals: a grass card lit by its own flat face reads like cardboard and picks up harsh terminator
  // lines. Leaning the shading normal toward world up makes the clump light like the ground it grows from —
  // soft and stylized. Done in the FRAGMENT stage so double-sided back faces get the same lift instead of
  // an inverted (lit-from-below) normal.
  vec3 nfUpView = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  normal = normalize(mix(normal, nfUpView, uNormalLift));
`;

function makeGrassMaterial(color: string, uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    map: getGrassClumpTextures().shade,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.3,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${FRAGMENT_NORMAL}`);
  };
  material.customProgramCacheKey = () => 'nf-stylized-grass-v1';
  return material;
}

// --- Component ----------------------------------------------------------------------------------------

/**
 * One instanced draw call of stylized grass clumps.
 *
 * Look pipeline per fragment: clump-card texture (silhouette + stroke shading) x grass tint x vertical
 * gradient x world-space colour variation, then trail tint on interaction. Motion per vertex: two-layer
 * noise wind + idle flutter + actor push + perspective correction, all masked to start above the bend pivot.
 */
export function StylizedGrass({
  color,
  settings,
  matrices,
  windVec,
  turbulence,
  windStrength,
  interactStrength = 1,
}: {
  color: string;
  settings: StylizedGrassSettings;
  matrices: THREE.Matrix4[];
  windVec: Vector3Tuple;
  turbulence: number;
  windStrength: number;
  /** Per-terrain multiplier on how hard actors part the grass (the shared foliage.interactStrength). */
  interactStrength?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const uniforms = useRef<GrassUniforms>(makeGrassUniforms());
  const material = useMemo(() => makeGrassMaterial(color, uniforms.current), [color]);

  // Keep the material tint in sync without rebuilding (and recompiling) the material on every colour tweak.
  useLayoutEffect(() => {
    material.color.set(color);
  }, [material, color]);

  // Built imperatively per component, so nothing else frees it. (The clump GEOMETRY is a module-level
  // singleton shared by every grass patch and must NOT be disposed here.)
  useEffect(() => () => material.dispose(), [material]);

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
    u.uWindSpeed.value = settings.windSpeed;
    u.uWindNoiseScale.value = settings.windNoiseScale;
    u.uBendPivot.value = settings.bendPivot;
    u.uGradTop.value.set(settings.gradientTop);
    u.uGradBottom.value.set(settings.gradientBottom);
    u.uGradOffset.value = settings.gradientOffset;
    u.uGradContrast.value = settings.gradientContrast;
    u.uNoiseLow.value.set(settings.colorNoiseLow);
    u.uNoiseHigh.value.set(settings.colorNoiseHigh);
    u.uNoiseScale.value = settings.colorNoiseScale;
    u.uNoiseStrength.value = settings.colorNoiseStrength;
    u.uNormalLift.value = settings.normalLift;
    u.uPerspective.value = settings.perspectiveCorrection;
    u.uPerspStart.value = settings.perspectiveHeightStart;
    u.uInteractStrength.value = settings.interactionStrength * interactStrength;
    u.uPushDown.value = settings.pushDownAmount * interactStrength;
    u.uTrailTint.value.set(settings.trailTint);
    const fadeMode = settings.fadeMode === 'smooth' ? 1 : settings.fadeMode === 'dither' ? 2 : 0;
    u.uFade.value.set(settings.fadeStart, Math.max(settings.fadeEnd, settings.fadeStart + 1), fadeMode);
  });

  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[GRASS_CLUMP_GEOMETRY, material, matrices.length]}
      // Grass RECEIVES shadows but never casts them. At tens of thousands of instances the cast pass is
      // both the single most expensive thing grass does and actively ugly: neighbouring blades smear each
      // other into a dark blob from any steep angle, which is not how stylized grass is meant to read.
      castShadow={false}
      receiveShadow
      // Foliage must never intercept pointer rays — otherwise blades sitting over the terrain swallow
      // sculpt/paint clicks (and the click reads as a "miss", deselecting the terrain).
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true }}
    />
  );
}
