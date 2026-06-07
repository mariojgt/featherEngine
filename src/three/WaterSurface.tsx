import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { defaultWaterVolume } from '../store/editor/defaults';
import { useEditorStore } from '../store/editorStore';
import { sunDirectionFromEnvironment, withSceneEnvironmentDefaults } from './environmentSettings';
import { registerWaterMesh, waterCapture } from './waterShared';
import type { SceneObject } from '../types';

/** Wave-mesh grid resolution per axis, by quality preset. Higher = smoother swell; normals are analytic
 *  in the shader so the per-frame cost is purely the GPU vertex count. */
const SEGMENTS_BY_QUALITY: Record<string, number> = { Low: 40, Medium: 64, High: 96, Epic: 128 };
const DEFAULT_SEGMENTS = 96;
/** Max concurrent impact ripples fed to the shader (matches the GLSL array length). */
const MAX_RIPPLES = 6;
const RIPPLE_SPEED = 3.2; // world units/sec a ring expands
const RIPPLE_LIFE = 2.4; // seconds before a ripple fully fades

const vertexShader = /* glsl */ `
uniform float uTime, uAmp, uFreq, uSpeed, uRippleAmp, uFlowStrength;
uniform vec2 uFlowDir; // unit current direction on XZ
uniform vec3 uRipples[${MAX_RIPPLES}]; // (worldX, worldZ, startTime); startTime < 0 = inactive
uniform mat4 uReflectionMatrix; // bias * mirrorProjection * mirrorView, for projective reflection sampling
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vHeight;
varying vec4 vReflCoord;
varying float vViewZ; // linear positive view-space depth of this water fragment

// Sum of directional swell (4 octaves), an optional flow-aligned travelling wave, plus live impact
// ripple rings — all sampled in world XZ. Keep in sync with waterSurfaceHeight() in editorStore.ts.
float waterHeight(vec2 p) {
  float h = 0.0;
  h += sin(dot(vec2(1.0, 0.0), p) * uFreq + uTime * uSpeed) * uAmp * 0.5;
  h += sin(dot(vec2(0.7071, 0.7071), p) * uFreq * 1.7 - uTime * uSpeed * 1.3) * uAmp * 0.28;
  h += sin(dot(vec2(-0.6, 0.8), p) * uFreq * 2.6 + uTime * uSpeed * 1.7) * uAmp * 0.16;
  h += sin(dot(vec2(0.2, -0.98), p) * uFreq * 3.7 - uTime * uSpeed * 2.1) * uAmp * 0.09;
  if (uFlowStrength > 0.0) {
    h += sin(dot(uFlowDir, p) * uFreq * 1.2 - uTime * uSpeed * (1.0 + uFlowStrength)) * uAmp * 0.2;
  }
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (uRipples[i].z < 0.0) continue;
    float age = uTime - uRipples[i].z;
    if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(1)}) continue;
    float radius = age * ${RIPPLE_SPEED.toFixed(1)};
    float dist = distance(p, uRipples[i].xy);
    float ring = sin((dist - radius) * 6.0);
    float env = exp(-abs(dist - radius) * 1.8) * (1.0 - age / ${RIPPLE_LIFE.toFixed(1)});
    h += ring * env * uRippleAmp;
  }
  return h;
}

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p = world.xz;
  float h = waterHeight(p);
  vHeight = h;
  world.y += h;
  // Slight horizontal chop so crests lean, not just bob.
  world.x += sin(p.x * uFreq + uTime * uSpeed) * uAmp * 0.05;
  world.z += cos(p.y * uFreq - uTime * uSpeed) * uAmp * 0.05;

  // Analytic normal from the height field (forward differences in world units).
  float e = 0.35;
  float hX = waterHeight(p + vec2(e, 0.0));
  float hZ = waterHeight(p + vec2(0.0, e));
  vNormal = normalize(vec3(h - hX, e, h - hZ));

  vWorldPos = world.xyz;
  vReflCoord = uReflectionMatrix * world;
  vViewZ = -(viewMatrix * world).z;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uShallow, uDeep, uFoamColor, uSunDir, uSunColor, uSkyTop, uSkyHorizon, uCamPos;
uniform float uOpacity, uReflect, uFoam, uSparkle, uEmissive, uCaustics, uAmp, uTime, uFlowStrength;
uniform vec2 uFlowDir;
// Scene-capture inputs (High/Epic). uUseReflection/uUseRefraction gate them; without captures the
// surface falls back to fresnel-sky reflection + UV-edge foam so it still looks right on Low/Medium.
uniform sampler2D uReflection, uSceneColor, uSceneDepth;
uniform vec2 uResolution;
uniform float uUseReflection, uUseRefraction, uNear, uFar, uRefract, uShoreFade, uRain;
uniform vec3 uAbsorb; // per-channel Beer-Lambert absorption coefficient (red highest)
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vHeight;
varying vec4 vReflCoord;
varying float vViewZ;

// Linear (view-space, positive) distance from a non-linear perspective depth sample.
float linearViewZ(float depth) {
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

// Raindrop ripples: expanding rings with a RANDOM centre + phase per grid cell, summed over two octaves
// at non-integer scales so the cell grid dissolves into scattered drops. Returns .xy = normal nudge
// (radial, for the dimple highlight) and .z = a foam ring factor.
vec3 rainRipples(vec2 p, float t) {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? 2.0 : 3.3;
    vec2 q = p * s + (k == 0 ? 0.0 : 11.0);
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
    vec2 center = vec2(h1, h2) * 0.6 + 0.2;
    float phase = fract(t * 0.9 + h1 * 7.0);
    vec2 d = f - center;
    float ring = smoothstep(0.07, 0.0, abs(length(d) - phase * 0.55)) * (1.0 - phase);
    acc.xy += normalize(d + 1e-4) * ring;
    acc.z += ring;
  }
  return acc;
}

void main() {
  vec3 N = normalize(vNormal);
  float rainFoam = 0.0;
  if (uRain > 0.001) {
    vec3 rf = rainRipples(vWorldPos.xz, uTime);
    N = normalize(N + vec3(rf.x, 0.0, rf.y) * uRain * 0.6);
    rainFoam = rf.z * uRain;
  }
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec2 screenUV = gl_FragCoord.xy / uResolution;

  // How much water sits between the surface and whatever is behind it (0 at the shoreline).
  float waterDepth = 1e4;
  if (uUseRefraction > 0.5) {
    float sceneZ = linearViewZ(texture2D(uSceneDepth, screenUV).x);
    waterDepth = max(0.0, sceneZ - vViewZ);
  }

  // Depth read: shallow water (small waterDepth, or steep view) reads as the shallow tint; deep reads deep.
  float depthMix = uUseRefraction > 0.5
    ? smoothstep(0.0, uShoreFade * 6.0, waterDepth)
    : smoothstep(0.0, 0.7, ndv);
  vec3 baseColor = mix(uShallow, uDeep, depthMix);

  // Refraction: the distorted view of whatever is submerged, blended in by clarity (1 - opacity), with
  // physical Beer-Lambert absorption — light dies off with depth, red fastest, so deeper water both
  // darkens and shifts toward its deep tint the way real water does.
  if (uUseRefraction > 0.5) {
    vec2 refrUV = clamp(screenUV + N.xz * uRefract, 0.001, 0.999);
    vec3 refrCol = texture2D(uSceneColor, refrUV).rgb;
    vec3 transmit = exp(-waterDepth * uAbsorb); // per-channel transmittance through the water column
    refrCol *= transmit;
    float clarity = (1.0 - uOpacity) * (1.0 - smoothstep(0.0, uShoreFade * 10.0, waterDepth));
    baseColor = mix(baseColor, refrCol, clamp(clarity, 0.0, 0.85));
  }

  // Fresnel reflection — real planar capture when available, else a sky gradient.
  float fres = pow(1.0 - ndv, 4.0);
  vec3 R = reflect(-V, N);
  vec3 skyCol = mix(uSkyHorizon, uSkyTop, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  if (uUseReflection > 0.5) {
    vec2 rUV = vReflCoord.xy / max(vReflCoord.w, 0.0001);
    rUV += N.xz * (uRefract * 1.5); // distort the mirror by the wave normal
    vec3 planar = texture2D(uReflection, clamp(rUV, 0.001, 0.999)).rgb;
    skyCol = mix(skyCol, planar, uUseReflection);
  }
  vec3 col = mix(baseColor, skyCol, fres * uReflect);

  // Sun glint — a smooth, broad sheen. Sparkle widens/strengthens the highlight rather than sharpening it
  // to a pinpoint (a high exponent on a faceted wave mesh produced a field of dotty per-facet glints).
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), mix(24.0, 90.0, uSparkle));
  col += uSunColor * spec * (0.35 + uSparkle * 0.4);

  // Caustic shimmer crawling across the surface (drifts along the current when flowing).
  vec2 cp = vWorldPos.xz - uFlowDir * uFlowStrength * uTime * 0.6;
  float c1 = sin(cp.x * 1.5 + uTime * 0.8) + sin(cp.y * 1.7 - uTime * 0.6);
  float c2 = sin((cp.x + cp.y) * 1.1 + uTime * 1.1);
  float caust = pow(max(0.0, (c1 + c2) * 0.25 + 0.5), 2.0);
  col += baseColor * caust * uCaustics * 0.6;

  // Foam: only the genuine breaking crests (near peak height), plus a shoreline line. With depth, the
  // line traces real intersections; without it, falls back to the volume's UV edges. The high threshold
  // keeps foam off every little ripple (which otherwise speckled the surface with white dots).
  float crest = smoothstep(uAmp * 0.82, uAmp * 1.02, vHeight);
  float shore;
  if (uUseRefraction > 0.5) {
    shore = 1.0 - smoothstep(0.0, uShoreFade, waterDepth);
  } else {
    float edgeDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    shore = 1.0 - smoothstep(0.0, 0.05, edgeDist);
  }
  float foamMask = clamp(max(max(crest, shore * 0.9) * uFoam * 1.6, rainFoam * 0.5), 0.0, 1.0);
  col = mix(col, uFoamColor, foamMask);

  // Self-illumination (lava / toxic).
  col += baseColor * uEmissive;

  // Alpha: base opacity, boosted by fresnel + foam, and faded softly to nothing at the shoreline.
  float alpha = clamp(uOpacity + fres * 0.25 * uReflect + foamMask * 0.5, 0.0, 1.0);
  if (uUseRefraction > 0.5) alpha *= smoothstep(0.0, uShoreFade, waterDepth);
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Realistic animated skin for a Water Volume — a custom GLSL surface that renders the SAME wave the
 * physics integrator uses, plus fresnel sky reflection, depth color, sun glints, caustics, crest/edge
 * foam, emissive glow (lava/toxic), and expanding impact ripples from `runtimeWaterImpacts`.
 *
 * Drawn as a standalone mesh (not a child of the volume's group) so it survives the Play-time
 * `hideInRuntime` filter, and it never raycasts so it can't steal selection clicks in the editor.
 */
export function WaterSurface({ object }: { object: SceneObject }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const environment = useEditorStore((state) =>
    state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment,
  );
  const env = useMemo(() => withSceneEnvironmentDefaults(environment), [environment]);
  const quality = useEditorStore((state) => state.renderSettings?.quality);
  const segments = SEGMENTS_BY_QUALITY[quality ?? ''] ?? DEFAULT_SEGMENTS;

  // Flat unit plane in the XZ plane (UVs 0..1 preserved for edge foam); scaled to the volume footprint.
  // Rebuilt only when the quality preset changes the tessellation.
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, segments, segments);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [segments]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.22 },
      uFreq: { value: 0.55 },
      uSpeed: { value: 1.4 },
      uRippleAmp: { value: 0.2 },
      uShallow: { value: new THREE.Color('#4FD2E8') },
      uDeep: { value: new THREE.Color('#0A3A66') },
      uFoamColor: { value: new THREE.Color('#EAF6FF') },
      uSunColor: { value: new THREE.Color('#FFF1C2') },
      uSkyTop: { value: new THREE.Color('#4F95FF') },
      uSkyHorizon: { value: new THREE.Color('#F7D08A') },
      uSunDir: { value: new THREE.Vector3(0.3, 0.7, 0.4) },
      uCamPos: { value: new THREE.Vector3() },
      uOpacity: { value: 0.82 },
      uReflect: { value: 0.6 },
      uFoam: { value: 0.5 },
      uSparkle: { value: 0.6 },
      uEmissive: { value: 0 },
      uCaustics: { value: 0.35 },
      uFlowDir: { value: new THREE.Vector2(1, 0) },
      uFlowStrength: { value: 0 },
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3(0, 0, -1)) },
      // Scene-capture inputs (filled from waterCapture on High/Epic; gates stay 0 otherwise).
      uReflection: { value: null as THREE.Texture | null },
      uSceneColor: { value: null as THREE.Texture | null },
      uSceneDepth: { value: null as THREE.Texture | null },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uUseReflection: { value: 0 },
      uUseRefraction: { value: 0 },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uRefract: { value: 0.04 },
      uShoreFade: { value: 0.5 },
      uAbsorb: { value: new THREE.Vector3(0.35, 0.12, 0.06) },
      uRain: { value: 0 },
    }),
    [],
  );

  // Dispose the wave geometry when the tessellation changes (quality switch) so we don't leak buffers.
  useEffect(() => () => geom.dispose(), [geom]);

  // Register the surface so the capture pass can hide it while re-rendering the scene.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    return registerWaterMesh(mesh);
  }, []);

  // Impact-ripple bookkeeping: a round-robin slot buffer + the highest impact id already consumed.
  const rippleSlot = useRef(0);
  const lastImpactId = useRef<number | null>(null);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const water = { ...defaultWaterVolume(), ...object.water };
    // During Play use the sim clock so the visible surface matches the buoyancy physics (which samples
    // the same wave field at runtimeTime); in edit mode animate off the render clock.
    const store = useEditorStore.getState();
    const t = store.isPlaying ? store.runtimeTime : state.clock.elapsedTime;

    const [posX, posY, posZ] = object.transform.position;
    const sx = Math.max(0.001, Math.abs(object.transform.scale[0]));
    const sy = Math.max(0.001, Math.abs(object.transform.scale[1]));
    const sz = Math.max(0.001, Math.abs(object.transform.scale[2]));
    mesh.position.set(posX, posY + sy * 0.5, posZ);
    mesh.scale.set(sx, 1, sz);

    const u = uniforms;
    u.uTime.value = t;
    u.uAmp.value = water.waveAmplitude;
    u.uFreq.value = water.waveFrequency;
    u.uSpeed.value = water.waveSpeed;
    u.uRippleAmp.value = Math.max(0.12, water.waveAmplitude * 0.9);
    u.uShallow.value.set(water.shallowColor ?? '#4FD2E8');
    u.uDeep.value.set(water.deepColor ?? '#0A3A66');
    u.uFoamColor.value.set(water.foamColor ?? '#EAF6FF');
    u.uOpacity.value = water.opacity ?? 0.82;
    u.uReflect.value = water.reflectivity ?? 0.6;
    u.uFoam.value = water.foam ?? 0.5;
    u.uSparkle.value = water.sparkle ?? 0.6;
    u.uEmissive.value = water.emissiveIntensity ?? 0;
    u.uCaustics.value = water.caustics ?? 0.35;
    const flowStrength = water.flowStrength ?? 0;
    u.uFlowStrength.value = flowStrength;
    if (flowStrength > 0) {
      const ang = ((water.flowAngle ?? 0) * Math.PI) / 180;
      u.uFlowDir.value.set(Math.cos(ang), Math.sin(ang));
    }
    u.uSunColor.value.set(env.sunColor);
    u.uSkyTop.value.set(env.skyTopColor);
    u.uSkyHorizon.value.set(env.skyHorizonColor);
    u.uSunDir.value.copy(sunDirectionFromEnvironment(env));
    u.uCamPos.value.copy(state.camera.position);

    // Pull in this frame's scene captures (planar reflection + refraction/depth). Gates stay 0 when the
    // capture pass is off (Low/Medium), so the shader uses its fresnel-sky + UV-edge fallback.
    u.uUseReflection.value = waterCapture.hasReflection ? 1 : 0;
    u.uReflection.value = waterCapture.reflection;
    u.uReflectionMatrix.value.copy(waterCapture.reflectionMatrix);
    u.uUseRefraction.value = waterCapture.hasRefraction ? 1 : 0;
    u.uSceneColor.value = waterCapture.sceneColor;
    u.uSceneDepth.value = waterCapture.sceneDepth;
    u.uResolution.value.copy(waterCapture.resolution);
    u.uNear.value = waterCapture.cameraNear;
    u.uFar.value = waterCapture.cameraFar;
    u.uRefract.value = 0.025 + (water.waveAmplitude ?? 0.2) * 0.05;
    u.uShoreFade.value = 0.6;
    // Murkier water (higher opacity) absorbs light over a shorter distance → shallower visibility.
    const absorbScale = 0.5 + (water.opacity ?? 0.82) * 2.4;
    u.uAbsorb.value.set(0.35 * absorbScale, 0.12 * absorbScale, 0.06 * absorbScale);
    u.uRain.value = water.rainStrength ?? 0;

    // Consume new surface impacts that land inside this volume → spawn an expanding ripple ring.
    const impacts = store.runtimeWaterImpacts;
    const newest = impacts.length ? impacts[impacts.length - 1].id : null;
    if (lastImpactId.current === null) {
      lastImpactId.current = newest; // first frame: treat everything already present as seen
    } else if (newest !== null && newest !== lastImpactId.current) {
      const halfX = sx * 0.5;
      const halfZ = sz * 0.5;
      for (const impact of impacts) {
        if (impact.id <= (lastImpactId.current ?? -1)) continue;
        if (Math.abs(impact.x - posX) > halfX + 1 || Math.abs(impact.z - posZ) > halfZ + 1) continue;
        const slot = u.uRipples.value[rippleSlot.current % MAX_RIPPLES];
        slot.set(impact.x, impact.z, t);
        rippleSlot.current += 1;
      }
      lastImpactId.current = newest;
    }
    // Retire ripples whose ring has fully faded.
    for (const r of u.uRipples.value) {
      if (r.z >= 0 && t - r.z > RIPPLE_LIFE) r.z = -1;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geom} raycast={() => {}} frustumCulled={false} renderOrder={2}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
