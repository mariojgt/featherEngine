import { forwardRef, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DataTexture, Matrix4, Uniform, Vector3 } from 'three';
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import type { SceneEnvironmentSettings } from '../types';
import type { QualityProfile } from './quality';
import { sunDirectionFromEnvironment, withSceneEnvironmentDefaults } from './environmentSettings';
import { LocalFogLights, localFogBudget, MAX_LOCAL_FOG_LIGHTS } from './localFogLights';

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
  localStrength: number;
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
    localStrength: Number.isFinite(env.volumetricLocalStrength) ? Math.max(0, Math.min(4, env.volumetricLocalStrength!)) : 0,
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
  uniform int localLightCount;
  uniform float localStrength;
  uniform vec4 localLightPosition[${MAX_LOCAL_FOG_LIGHTS}];
  uniform vec3 localLightColor[${MAX_LOCAL_FOG_LIGHTS}];
  uniform vec4 localLightDirection[${MAX_LOCAL_FOG_LIGHTS}];
  uniform vec2 localLightCone[${MAX_LOCAL_FOG_LIGHTS}];

  #define VF_PI 3.141592653589793

  // Henyey–Greenstein phase function: forward-scatters toward the sun for positive g (the "glow").
  float vfPhase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return (1.0 - g2) / (4.0 * VF_PI * pow(max(denom, 1e-4), 1.5));
  }

  // three.js packs shadow depth into RGBA — matches packing.glsl.js unpackRGBAToDepth.
  float vfUnpackDepth(vec4 v) {
    const vec4 bitSh = vec4(255.0 / 256.0, 255.0 / 65536.0, 255.0 / 16777216.0, 1.0 / 16777216.0);
    return dot(v, bitSh);
  }

  // 1.0 = lit, 0.0 = in sun shadow. Outside the shadow frustum counts as lit (no shaft data there).
  // A small 3x3 PCF kernel softens the shaft edges into proper volumetric beams (vs a hard single tap).
  float vfSunVisibility(vec3 worldPos) {
    if (shaftStrength <= 0.0) return 1.0;
    vec4 sc = shadowMatrix * vec4(worldPos, 1.0);
    vec3 s = sc.xyz / sc.w;
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
    float depthRef = s.z - 0.0015;
    vec2 texel = 1.0 / vec2(textureSize(shadowMap, 0));
    float lit = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        float occluder = vfUnpackDepth(texture(shadowMap, s.xy + vec2(float(x), float(y)) * texel));
        lit += depthRef <= occluder ? 1.0 : 0.0;
      }
    }
    return lit / 9.0;
  }

  float vfHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Integrate the exponential height profile exactly, splitting at the flat-density layer.
  // This also gives each local-light sample its camera-to-sample extinction without a second march.
  float vfOpticalDepth(vec3 rayDir, float distance) {
    float y = cameraPos.y - heightStart;
    float slope = heightFalloff * rayDir.y;
    if (abs(slope) < 0.00001) return density * distance * exp(-max(0.0, y) * heightFalloff);
    float crossing = clamp(-y / rayDir.y, 0.0, distance);
    float start = rayDir.y > 0.0 ? crossing : 0.0;
    float end = rayDir.y > 0.0 ? distance : crossing;
    float flatLength = distance - (end - start);
    float above = (exp(-max(0.0, y + rayDir.y * start) * heightFalloff)
                 - exp(-max(0.0, y + rayDir.y * end) * heightFalloff)) / slope;
    return density * max(0.0, flatLength + above);
  }

  // A forward cone is convex. Clip the visible ray against its forward half-space and quadratic
  // boundary so even a sub-step searchlight gets its own integration interval. Rectangles use a
  // hemisphere (cosOuter == 0), matching their existing directional approximation.
  bool vfClipCone(vec3 origin, vec3 ray, vec3 axis, float cosOuter, inout vec2 interval) {
    float axialOrigin = dot(origin, axis), axialRay = dot(ray, axis);
    if (abs(axialRay) < 0.000001) {
      if (axialOrigin < 0.0) return false;
    } else if (axialRay > 0.0) interval.x = max(interval.x, -axialOrigin / axialRay);
    else interval.y = min(interval.y, -axialOrigin / axialRay);
    if (interval.x >= interval.y) return false;
    if (cosOuter <= 0.0001) return true;
    float c2 = cosOuter * cosOuter;
    float a = axialRay * axialRay - c2;
    float b = axialOrigin * axialRay - c2 * dot(origin, ray);
    float c = axialOrigin * axialOrigin - c2 * dot(origin, origin);
    if (abs(a) < 0.000001) {
      if (abs(b) < 0.000001) return c >= 0.0;
      if (b > 0.0) interval.x = max(interval.x, -c / (2.0 * b));
      else interval.y = min(interval.y, -c / (2.0 * b));
    } else {
      float discriminant = b * b - a * c;
      if (discriminant < 0.0) return a > 0.0;
      float root = sqrt(max(0.0, discriminant));
      vec2 roots = vec2((-b - root) / a, (-b + root) / a);
      if (roots.x > roots.y) roots = roots.yx;
      if (a < 0.0) interval = vec2(max(interval.x, roots.x), min(interval.y, roots.y));
      else if (axialRay > 0.0) interval.x = max(interval.x, roots.y);
      else interval.y = min(interval.y, roots.x);
    }
    return interval.x < interval.y;
  }

  #define VF_LOCAL_SAMPLES 24
  vec3 vfLocalIntegral(vec3 rayDir, float sceneDist) {
    vec3 radiance = vec3(0.0);
    int lightSteps = steps >= 40 ? 24 : (steps >= 24 ? 16 : 12);
    for (int j = 0; j < ${MAX_LOCAL_FOG_LIGHTS}; j++) {
      if (j >= localLightCount) break;
      vec3 origin = cameraPos - localLightPosition[j].xyz;
      float closest = -dot(origin, rayDir);
      float perpendicular2 = max(0.0, dot(origin, origin) - closest * closest);
      float range = localLightPosition[j].w;
      float discriminant = range * range - perpendicular2;
      if (discriminant <= 0.0) continue;
      float radius = sqrt(discriminant);
      vec2 interval = vec2(max(0.0, closest - radius), min(sceneDist, closest + radius));
      if (interval.x >= interval.y) continue;
      bool coneLight = localLightDirection[j].w > 0.5;
      if (coneLight && !vfClipCone(origin, rayDir, localLightDirection[j].xyz, localLightCone[j].x, interval)) continue;
      // Equiangular quadrature concentrates samples around the inverse-square peak. Uniform world
      // steps miss small lights or produce a noisy single bright sample; no random jitter is needed.
      float width = sqrt(max(1.0, perpendicular2));
      float angleStart = atan((interval.x - closest) / width);
      float angleEnd = atan((interval.y - closest) / width);
      float angleStep = (angleEnd - angleStart) / float(lightSteps);
      float integral = 0.0;
      for (int k = 0; k < VF_LOCAL_SAMPLES; k++) {
        if (k >= lightSteps) break;
        float tangent = tan(angleStart + (float(k) + 0.5) * angleStep);
        float t = closest + width * tangent;
        vec3 delta = origin + rayDir * t;
        float distanceSquared = dot(delta, delta);
        vec3 direction = delta / sqrt(max(distanceSquared, 0.0001));
        float cutoff = pow(clamp(1.0 - distanceSquared / (range * range), 0.0, 1.0), 2.0);
        float cone = coneLight ? smoothstep(localLightCone[j].x, max(localLightCone[j].x + 0.001, localLightCone[j].y), dot(direction, localLightDirection[j].xyz)) : 1.0;
        float phase = vfPhase(dot(rayDir, -direction), min(scattering, 0.65));
        float localDensity = density * exp(-max(0.0, cameraPos.y + rayDir.y * t - heightStart) * heightFalloff);
        float jacobian = width * (1.0 + tangent * tangent) * angleStep;
        integral += exp(-vfOpticalDepth(rayDir, t)) * localDensity * cutoff * cone * phase * jacobian / max(1.0, distanceSquared);
      }
      radiance += localLightColor[j] * integral;
    }
    return radiance * localStrength;
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

    float transmittance = exp(-vfOpticalDepth(rayDir, sceneDist));
    float phase = vfPhase(dot(rayDir, sunDirection), scattering);
    vec3 accum = fogColor * (1.0 - transmittance);
    if (sunStrength > 0.0) {
      float sunIntegral = 1.0 - transmittance;
      if (shaftStrength > 0.0) {
        float stepLen = sceneDist / float(steps);
        float jitter = vfHash(gl_FragCoord.xy);
        float previousTrans = 1.0;
        sunIntegral = 0.0;
        for (int i = 0; i < ${MAX_STEPS}; i++) {
          if (i >= steps) break;
          float nextTrans = exp(-vfOpticalDepth(rayDir, float(i + 1) * stepLen));
          vec3 p = cameraPos + rayDir * ((float(i) + jitter) * stepLen);
          sunIntegral += (previousTrans - nextTrans) * vfSunVisibility(p);
          previousTrans = nextTrans;
        }
      }
      accum += sunColor * (sunStrength * phase * sunIntegral);
    }
    if (localStrength > 0.0) accum += vfLocalIntegral(rayDir, sceneDist);

    outputColor = vec4(inputColor.rgb * transmittance + accum, inputColor.a);
  }
`;

export class VolumetricFogEffect extends Effect {
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
        ['localLightCount', new Uniform(0)],
        ['localStrength', new Uniform(0)],
        ['localLightPosition', new Uniform([])],
        ['localLightColor', new Uniform([])],
        ['localLightDirection', new Uniform([])],
        ['localLightCone', new Uniform([])],
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
  const localLights = useMemo(() => new LocalFogLights(), []);
  // Cached sun pick for the shaft pass: the full scene.traverse to find the best-matching directional
  // light ran EVERY frame (a whole-graph walk on big scenes). The winner barely ever changes, so keep
  // it and re-scan on a slow cadence (or immediately when the cached light dies/loses its shadow map).
  const sunCache = useRef<{ light: THREE.DirectionalLight | null; cooldown: number }>({ light: null, cooldown: 0 });

  // Static look params (cheap to set on render; also re-applied each frame below for runtime env tweaks).
  const u = effect.uniforms;
  (u.get('sunColor')!.value as Color).set(params.sunColor || '#ffffff');
  (u.get('fogColor')!.value as Color).set(params.fogColor || '#cfd8e8');

  useFrame(({ camera, clock }) => {
    const p = paramsRef.current;
    const uu = effect.uniforms;
    camera.updateWorldMatrix(true, false);
    (uu.get('inverseProjection')!.value as Matrix4).copy(camera.projectionMatrixInverse);
    (uu.get('cameraMatrixWorld')!.value as Matrix4).copy(camera.matrixWorld);
    (uu.get('cameraPos')!.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
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
    if (p.localStrength > 0) localLights.update(scene, uu.get('cameraPos')!.value as Vector3, localFogBudget(p.steps));
    uu.get('localStrength')!.value = p.localStrength;
    uu.get('localLightCount')!.value = p.localStrength > 0 ? localLights.count : 0;
    uu.get('localLightPosition')!.value = localLights.positions;
    uu.get('localLightColor')!.value = localLights.colors;
    uu.get('localLightDirection')!.value = localLights.directions;
    uu.get('localLightCone')!.value = localLights.cones;

    // God-ray shafts: sample a directional light's shadow map. Pick the shadow-casting directional
    // light whose direction best matches the sun (there can be several lights in the scene); only ones
    // with a live shadow map qualify. Null-safe — until a map exists we just skip shafts this frame.
    let shaft = 0;
    if (p.shaftStrength > 0) {
      const cache = sunCache.current;
      cache.cooldown -= 1;
      let best = cache.light ?? undefined;
      const stillValid = best && best.parent && best.castShadow && best.shadow?.map?.texture;
      if (!stillValid || cache.cooldown <= 0) {
        best = undefined;
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
        cache.light = best ?? null;
        cache.cooldown = 30; // ~0.5s at 60Hz — bounds staleness if a better-matching sun appears
      }
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
