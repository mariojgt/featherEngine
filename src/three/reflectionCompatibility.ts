import * as THREE from 'three';
import { reflectionWeatherUniforms, surfaceWeatherDeclarations, wetSurfaceShader } from './surfaceWeatherMaterials';

// @react-three/postprocessing 2.19's bundled SSR predates Three's renamed normal-map
// defines. Keep the fix local to each effect, without modifying global shader chunks.
type ReflectionPass = {
  setMRTMaterialInScene(): void;
  dispose(): void;
  visibleMeshes: THREE.Mesh[];
  cachedMaterials: WeakMap<THREE.Mesh, [THREE.Material, THREE.ShaderMaterial]>;
  fullscreenMaterial?: THREE.ShaderMaterial;
  depthTexture?: THREE.Texture;
  normalTexture?: THREE.Texture;
};
type ReflectionEffect = {
  _camera?: THREE.Camera;
  getFragmentShader?(): string;
  setFragmentShader?(shader: string): void;
  reflectionsPass?: ReflectionPass;
  usingBoxProjectedEnvMap?: boolean;
  update?: (...args: unknown[]) => unknown;
  temporalResolvePass?: {
    dispose(): void;
    lastVelocityTexture: THREE.Texture;
    fullscreenMaterial?: THREE.ShaderMaterial;
    velocityPass?: Pick<ReflectionPass, 'visibleMeshes' | 'cachedMaterials' | 'dispose'> & { setVelocityMaterialInScene(): void };
  };
};
const installed = new WeakSet<object>();

// The bundled effect's actual API differs from the wrapper's legacy TypeScript props.
// In particular STRETCH_MISSED_RAYS, rayStep and temporalResolveMix are ignored by it.
export const reflectionTraceOptions = {
  missedRays: false, distance: 40, steps: 80, refineSteps: 8,
  thickness: 0.5, maxDepthDifference: 0.12,
  blend: 0.65, correction: 1, blur: 0.25, blurKernel: 1, blurSharpness: 20,
  jitter: 0, jitterRoughness: 0,
};

/** Reject history after cuts, teleports or projection changes; ordinary dolly motion retains it. */
export class ReflectionHistory {
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private projection = new THREE.Matrix4();
  private nextPosition = new THREE.Vector3();
  private nextRotation = new THREE.Quaternion();
  private initialized = false;
  update(camera: THREE.Camera): boolean {
    camera.updateWorldMatrix(true, false);
    const position = this.nextPosition.setFromMatrixPosition(camera.matrixWorld);
    const rotation = this.nextRotation.setFromRotationMatrix(camera.matrixWorld);
    const reset = !this.initialized || this.position.distanceToSquared(position) > 4
      || 1 - Math.abs(this.rotation.dot(rotation)) > 0.015
      || !this.projection.equals(camera.projectionMatrix);
    this.position.copy(position); this.rotation.copy(rotation); this.projection.copy(camera.projectionMatrix);
    this.initialized = true;
    return reset;
  }
}

export function prepareReflectionMaterial(material: THREE.ShaderMaterial) {
  // vViewPosition is also needed for world-space puddle/ripple evaluation.
  const conditional = /#if defined\(FLAT_SHADED\) \|\| defined\(USE_BUMPMAP\) \|\| defined\(TANGENTSPACE_NORMALMAP\)/g;
  material.vertexShader = material.vertexShader.replace(conditional, '#if 1');
  material.fragmentShader = material.fragmentShader.replace(conditional, '#if 1')
    .replace('#include <packing>', '#include <common>\n#include <packing>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\nuniform float opacity, alphaTest;\n#define FEATHER_REFLECTION_BUFFER\n' + surfaceWeatherDeclarations)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float featherOpacity = opacity;
      #ifdef USE_MAP
        featherOpacity *= texture2D(map, vMapUv).a;
      #endif
      #ifdef USE_ALPHAMAP
        featherOpacity *= texture2D(alphaMap, vAlphaMapUv).g;
      #endif
      if (featherOpacity < max(alphaTest, 0.001)) discard;
    `)
    .replace('texture2D(roughnessMap, vUv)', 'texture2D(roughnessMap, vRoughnessMapUv)')
    .replace('vec3 normalColor = packNormalToRGB(normal);', wetSurfaceShader + '\nvec3 normalColor = packNormalToRGB(normal);');
  // Current Three UV chunks use per-texture transforms; the older pass only supplies vUv.
  material.uniforms.normalMapTransform = new THREE.Uniform(new THREE.Matrix3());
  material.uniforms.roughnessMapTransform = new THREE.Uniform(new THREE.Matrix3());
  material.uniforms.mapTransform = new THREE.Uniform(new THREE.Matrix3());
  material.uniforms.alphaMapTransform = new THREE.Uniform(new THREE.Matrix3());
  material.uniforms.map = new THREE.Uniform(null);
  material.uniforms.alphaMap = new THREE.Uniform(null);
  material.uniforms.normalMap ??= new THREE.Uniform(null);
  material.uniforms.roughnessMap ??= new THREE.Uniform(null);
  material.uniforms.opacity = new THREE.Uniform(1);
  material.uniforms.alphaTest = new THREE.Uniform(0);
  material.needsUpdate = true;
}

/** Install before the effect's first render; all updates and allocations belong to this instance. */
export function installReflectionCompatibility(effect: unknown, renderer: THREE.WebGLRenderer) {
  if (!effect || typeof effect !== 'object' || installed.has(effect)) return;
  const instance = effect as ReflectionEffect;
  const pass = instance.reflectionsPass;
  if (!pass) return;
  installed.add(effect);
  Object.assign(instance, reflectionTraceOptions);
  if (instance.getFragmentShader && instance.setFragmentShader) {
    // GLSL does not guarantee zero initialization for local blur accumulators.
    instance.setFragmentShader(instance.getFragmentShader()
      .replace('vec3 color, col;', 'vec3 color = vec3(0.0), col;')
      .replace('float total, weight;', 'float total = 0.0, weight;'));
  }
  // Packed depth and silhouette normals cannot be linearly interpolated across geometry edges.
  for (const texture of [pass.depthTexture, pass.normalTexture]) if (texture) {
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
  }
  if (pass.fullscreenMaterial) {
    // Physical materials already contain sky/probe IBL. The library adds a sharp sky
    // reflection even ABOVE maxRoughness, washing out matte grass and castle stone.
    // Missed screen traces should contribute zero; the base material supplies the fallback.
    pass.fullscreenMaterial.fragmentShader = pass.fullscreenMaterial.fragmentShader
      .replace(/vec3 iblRadiance = [^;]+;/, 'vec3 iblRadiance = vec3(0.0);')
      // Feeding the previous reflection back through a new hit makes bright signs echo and smear.
      .replace('vec3 SSR = SSRTexel.rgb + SSRTexelReflected.rgb;', 'vec3 SSR = SSRTexel.rgb;')
      .replace('vec3 viewNormal = normalTexel.xyz;', 'vec3 viewNormal = normalize(normalTexel.xyz);')
      .replace('vec3 finalSSR = mix(iblRadiance, SSR, reflectionIntensity) * roughnessFactor;',
        'vec3 finalSSR = mix(iblRadiance, SSR, reflectionIntensity) * roughnessFactor * (1.0 - smoothstep(maxRoughness * 0.75, maxRoughness, roughness));');
    pass.fullscreenMaterial.needsUpdate = true;
    instance.usingBoxProjectedEnvMap = true; // Skip the unused automatic environment-map setup.
  }
  const originalSet = pass.setMRTMaterialInScene;
  const originalDispose = pass.dispose;
  const materials = new Set<THREE.ShaderMaterial>();
  pass.setMRTMaterialInScene = function () {
    originalSet.call(this);
    for (const mesh of this.visibleMeshes) {
      const cached = this.cachedMaterials.get(mesh);
      if (!cached) continue;
      const [source, material] = cached;
      const pbr = source as THREE.MeshStandardMaterial;
      if (!materials.has(material)) {
        prepareReflectionMaterial(material);
        materials.add(material);
        material.addEventListener('dispose', () => materials.delete(material));
      }
      Object.assign(material.uniforms, reflectionWeatherUniforms(renderer, source));
      for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap'] as const) {
        const texture = pbr[key] ?? null;
        const mappedMaterial = material as THREE.ShaderMaterial & Record<typeof key, THREE.Texture | null>;
        if (mappedMaterial[key] !== texture) {
          mappedMaterial[key] = texture;
          material.uniforms[key].value = texture;
          material.needsUpdate = true;
        }
        if (texture) {
          if (texture.matrixAutoUpdate) texture.updateMatrix();
          material.uniforms[`${key}Transform`].value.copy(texture.matrix);
        }
      }
      material.uniforms.opacity.value = source.opacity ?? 1;
      material.uniforms.alphaTest.value = source.alphaTest ?? 0;
      material.side = source.side ?? THREE.FrontSide;
      // The upstream `roughness || 0` made non-PBR foliage/particles perfect mirrors.
      if (material.uniforms.roughness.value < 1e10) {
        material.uniforms.roughness.value = pbr.isMeshStandardMaterial ? pbr.roughness : 1;
      }
    }
  };
  pass.dispose = function () {
    for (const material of materials) material.dispose();
    materials.clear();
    originalDispose.call(this);
  };
  const temporal = instance.temporalResolvePass;
  if (temporal) {
    if (temporal.fullscreenMaterial) {
      temporal.fullscreenMaterial.uniforms.featherHistoryValid = new THREE.Uniform(0);
      temporal.fullscreenMaterial.fragmentShader = 'uniform float featherHistoryValid;\n' + temporal.fullscreenMaterial.fragmentShader.replace(
        'vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);',
        'vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);\nif (featherHistoryValid < 0.5) { gl_FragColor = vec4(inputTexel.rgb, 0.0); return; }',
      ).replace('float velocityDisocclusion;', 'float velocityDisocclusion = 0.0;')
        // Keep accepting fresh radiance when a neon light changes under a stationary camera.
        .replace('alpha = clamp(alpha, 0.0, 1.0);', 'alpha = clamp(alpha, 0.0, 0.95);')
        .replace('float m = mix(alpha, 1.0, blend);', 'float m = min(0.92, mix(alpha, 1.0, blend));');
      temporal.fullscreenMaterial.needsUpdate = true;
    }
    const velocity = temporal.velocityPass;
    const velocityMaterials = new Set<THREE.ShaderMaterial>();
    if (velocity) {
      const setVelocity = velocity.setVelocityMaterialInScene;
      velocity.setVelocityMaterialInScene = function () {
        setVelocity.call(this);
        for (const mesh of this.visibleMeshes) {
          const material = this.cachedMaterials.get(mesh)?.[1];
          if (material) velocityMaterials.add(material);
        }
      };
    }
    const disposeTemporal = temporal.dispose;
    temporal.dispose = function () {
      // The bundled resolver frees this texture on resize, but omits it on disposal.
      this.lastVelocityTexture.dispose();
      for (const material of velocityMaterials) {
        material.uniforms.prevBoneTexture?.value?.dispose();
        material.dispose();
      }
      velocityMaterials.clear();
      disposeTemporal.call(this);
    };
  }
  // Auxiliary materials must never overwrite the scene's actual alpha-tested shadow maps.
  const update = instance.update;
  const history = new ReflectionHistory();
  if (update) instance.update = function (...args) {
    if (instance._camera && temporal?.fullscreenMaterial) {
      temporal.fullscreenMaterial.uniforms.featherHistoryValid.value = history.update(instance._camera) ? 0 : 1;
    }
    const auto = renderer.shadowMap.autoUpdate, needs = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    try { return update.apply(this, args); }
    finally { renderer.shadowMap.autoUpdate = auto; renderer.shadowMap.needsUpdate = needs; }
  };
}
