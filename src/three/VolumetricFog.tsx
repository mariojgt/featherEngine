import { forwardRef, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DataTexture, Matrix4, Uniform, Vector3 } from 'three';
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import type { SceneEnvironmentSettings } from '../types';
import type { QualityProfile } from './quality';
import { sunDirectionFromEnvironment, withSceneEnvironmentDefaults } from './environmentSettings';

/**
 * Fully-resolved volumetric-fog parameters fed to the shader (scene environment + quality tier already
 * merged). `resolveVolumetric` returns `null` when the effect should not render at all (disabled,
 * tier-gated off, or zero density), parallel to `resolveGrade` in ColorGrade.tsx.
 */
export interface VolumetricParams {
  density: number;
  heightStart: number;
  heightFalloff: number;
  scattering: number;
  sunStrength: number;
  maxDistance: number;
  steps: number;
  /** 0 disables shadow-map sampling (no god-ray shafts) — gated to the Epic tier. */
  shaftStrength: number;
  sunColor: string;
  fogColor: string;
  sunDirection: Vector3;
}

/** Resolve scene environment + quality profile into shader params, or `null` when the effect is off. */
export function resolveVolumetric(
  environment: Partial<SceneEnvironmentSettings> | undefined,
  profile: QualityProfile,
): VolumetricParams | null {
  if (!profile.volumetricFog) return null;
  const env = withSceneEnvironmentDefaults(environment);
  if (!env.volumetricFogEnabled) return null;
  const density = env.volumetricFogDensity ?? 0.06;
  if (density <= 0.0001) return null;
  return {
    density,
    heightStart: env.volumetricFogHeight ?? 0,
    heightFalloff: Math.max(0, env.volumetricFogFalloff ?? 0.08),
    scattering: THREE.MathUtils.clamp(env.volumetricScattering ?? 0.7, -0.95, 0.95),
    sunStrength: Math.max(0, env.volumetricSunStrength ?? 1.2),
    maxDistance: Math.max(1, env.volumetricMaxDistance ?? 120),
    steps: Math.max(1, Math.round(profile.volumetricSteps)),
    shaftStrength: profile.volumetricShafts ? 1 : 0,
    sunColor: env.sunColor,
    fogColor: env.volumetricFogColor ?? '#cfd8e8',
    sunDirection: sunDirectionFromEnvironment(env),
  };
}

// Hard upper bound for the (WebGL2) raymarch loop; the live count comes from uSteps and is clamped here.
const MAX_STEPS = 64;

const fragmentShader = /* glsl */ `
  uniform mat4 inverseProjection;
  uniform mat4 cameraMatrixWorld;
  uniform vec3 cameraPos;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 fogColor;
  uniform float density;
  uniform float heightStart;
  uniform float heightFalloff;
  uniform float scattering;
  uniform float sunStrength;
  uniform float maxDistance;
  uniform int steps;
  uniform float time;
  uniform float shaftStrength;
  uniform sampler2D shadowMap;
  uniform mat4 shadowMatrix;

  #define VF_PI 3.141592653589793

  // Henyey–Greenstein phase function: forward-scatters toward the sun for positive g (the "glow").
  float vfPhase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return (1.0 - g2) / (4.0 * VF_PI * pow(max(denom, 1e-4), 1.5));
  }

  // three.js packs shadow depth into RGBA — matches packing.glsl.js unpackRGBAToDepth.
  float vfUnpackDepth(vec4 v) {
    const vec4 bitSh = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
    return dot(v, bitSh);
  }

  // 1.0 = lit, 0.0 = in sun shadow. Outside the shadow frustum counts as lit (no shaft data there).
  float vfSunVisibility(vec3 worldPos) {
    if (shaftStrength <= 0.0) return 1.0;
    vec4 sc = shadowMatrix * vec4(worldPos, 1.0);
    vec3 s = sc.xyz / sc.w;
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
    float occluder = vfUnpackDepth(texture(shadowMap, s.xy));
    return (s.z - 0.0015) <= occluder ? 1.0 : 0.0;
  }

  float vfHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // Reconstruct the world-space point under this pixel from the depth buffer.
    vec3 ndc = vec3(uv * 2.0 - 1.0, depth * 2.0 - 1.0);
    vec4 viewPos = inverseProjection * vec4(ndc, 1.0);
    viewPos /= viewPos.w;
    vec3 worldPos = (cameraMatrixWorld * vec4(viewPos.xyz, 1.0)).xyz;

    vec3 rayDir = normalize(worldPos - cameraPos);
    // depth ~1.0 means sky / nothing hit — march the full range instead of to the far plane.
    float sceneDist = depth >= 0.9999 ? maxDistance : min(length(worldPos - cameraPos), maxDistance);

    float stepLen = sceneDist / float(steps);
    // Per-pixel + temporal dither so low step counts don't band.
    float jitter = vfHash(gl_FragCoord.xy + time);
    float t = stepLen * jitter;

    float phase = vfPhase(dot(rayDir, sunDirection), scattering);
    vec3 accum = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < ${MAX_STEPS}; i++) {
      if (i >= steps) break;
      vec3 p = cameraPos + rayDir * t;
      float h = exp(-max(0.0, p.y - heightStart) * heightFalloff);
      float d = density * h;
      if (d > 0.0) {
        float lit = vfSunVisibility(p);
        // In-scattered radiance: ambient mist colour + sun glow/shafts via the phase function.
        vec3 inScatter = fogColor + sunColor * (sunStrength * phase * lit);
        float segTrans = exp(-d * stepLen);
        accum += transmittance * (1.0 - segTrans) * inScatter;
        transmittance *= segTrans;
      }
      t += stepLen;
      if (t >= sceneDist) break;
    }

    outputColor = vec4(inputColor.rgb * transmittance + accum, inputColor.a);
  }
`;

class VolumetricFogEffect extends Effect {
  constructor() {
    super('VolumetricFogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['inverseProjection', new Uniform(new Matrix4())],
        ['cameraMatrixWorld', new Uniform(new Matrix4())],
        ['cameraPos', new Uniform(new Vector3())],
        ['sunDirection', new Uniform(new Vector3(0, 1, 0))],
        ['sunColor', new Uniform(new Color('#ffffff'))],
        ['fogColor', new Uniform(new Color('#cfd8e8'))],
        ['density', new Uniform(0.06)],
        ['heightStart', new Uniform(0)],
        ['heightFalloff', new Uniform(0.08)],
        ['scattering', new Uniform(0.7)],
        ['sunStrength', new Uniform(1.2)],
        ['maxDistance', new Uniform(120)],
        ['steps', new Uniform(24)],
        ['time', new Uniform(0)],
        ['shaftStrength', new Uniform(0)],
        ['shadowMap', new Uniform(null)],
        ['shadowMatrix', new Uniform(new Matrix4())],
      ]),
    });
  }
}

// Scratch vector reused each frame when matching the shaft light's direction (avoids per-frame allocs).
const TMP_DIR = new Vector3();

// 1x1 white fallback so the shadowMap sampler is always bound (avoids unbound/empty-sampler warnings
// when shafts are off or the sun shadow map hasn't rendered yet). shaftStrength gates actual sampling.
const FALLBACK_TEX = (() => {
  const tex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
})();

/**
 * React wrapper for the volumetric-fog effect, used as a child of <EffectComposer>. The effect instance
 * is created once; camera matrices, time and the sun shadow map are refreshed every frame (the camera
 * moves and the shadow map re-renders per frame), while the look params come from props.
 */
export const VolumetricFog = forwardRef<VolumetricFogEffect, VolumetricParams>((params, ref) => {
  const effect = useMemo(() => new VolumetricFogEffect(), []);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const { scene } = useThree();

  // Static look params (cheap to set on render; also re-applied each frame below for runtime env tweaks).
  const u = effect.uniforms;
  (u.get('sunColor')!.value as Color).set(params.sunColor || '#ffffff');
  (u.get('fogColor')!.value as Color).set(params.fogColor || '#cfd8e8');

  useFrame(({ camera, clock }, delta) => {
    const p = paramsRef.current;
    const uu = effect.uniforms;
    (uu.get('inverseProjection')!.value as Matrix4).copy(camera.projectionMatrixInverse);
    (uu.get('cameraMatrixWorld')!.value as Matrix4).copy(camera.matrixWorld);
    (uu.get('cameraPos')!.value as Vector3).copy(camera.position);
    (uu.get('sunDirection')!.value as Vector3).copy(p.sunDirection).normalize();
    (uu.get('sunColor')!.value as Color).set(p.sunColor || '#ffffff');
    (uu.get('fogColor')!.value as Color).set(p.fogColor || '#cfd8e8');
    uu.get('density')!.value = p.density;
    uu.get('heightStart')!.value = p.heightStart;
    uu.get('heightFalloff')!.value = p.heightFalloff;
    uu.get('scattering')!.value = p.scattering;
    uu.get('sunStrength')!.value = p.sunStrength;
    uu.get('maxDistance')!.value = p.maxDistance;
    uu.get('steps')!.value = p.steps;
    uu.get('time')!.value = clock.elapsedTime;

    // God-ray shafts: sample a directional light's shadow map. Pick the shadow-casting directional
    // light whose direction best matches the sun (there can be several lights in the scene); only ones
    // with a live shadow map qualify. Null-safe — until a map exists we just skip shafts this frame.
    let shaft = 0;
    if (p.shaftStrength > 0) {
      let best: THREE.DirectionalLight | undefined;
      let bestDot = -2;
      scene.traverse((o) => {
        const light = o as THREE.DirectionalLight;
        if (!light.isDirectionalLight || !light.castShadow || !light.shadow?.map?.texture) return;
        // Light points from its position toward its target; our sunDirection points toward the sun.
        const dir = TMP_DIR.copy(light.position).sub(light.target.position).normalize();
        const d = dir.dot(p.sunDirection);
        if (d > bestDot) {
          bestDot = d;
          best = light;
        }
      });
      if (best) {
        uu.get('shadowMap')!.value = best.shadow.map!.texture;
        (uu.get('shadowMatrix')!.value as Matrix4).copy(best.shadow.matrix);
        shaft = p.shaftStrength;
      }
    }
    if (uu.get('shadowMap')!.value == null) uu.get('shadowMap')!.value = FALLBACK_TEX;
    uu.get('shaftStrength')!.value = shaft;
  });

  return <primitive ref={ref} object={effect} dispose={null} />;
});
VolumetricFog.displayName = 'VolumetricFog';
