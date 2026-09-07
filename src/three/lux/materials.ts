import * as THREE from 'three';

export function createLuxUniforms() {
  return {
    luxActive: { value: 0 }, luxOrigin: { value: new THREE.Vector3() }, luxRadius: { value: 24 },
    luxSH: { value: new THREE.SphericalHarmonics3().coefficients }, luxIndirect: { value: 0.65 },
    luxReflection: { value: null as THREE.Texture | null }, luxReflectionGain: { value: 0 },
    luxAtlas: { value: new THREE.Vector3(1 / 336, 1 / 256, 6) },
  };
}
export type LuxUniforms = ReturnType<typeof createLuxUniforms>;

// Three caches shader uniforms per material/program. Re-enabling an identical program can bypass
// onBeforeCompile entirely, so retain its uniform holders and retarget their source to the new cache.
// Both renderer and material keys are weak: inactive scenes/Canvases remain collectible.
type Binding = { source: LuxUniforms; allow: { value: number }; shaderUniforms: Record<string, { readonly value: unknown }> };
const bindings = new WeakMap<object, WeakMap<THREE.Material, Binding>>();
function bindingFor(renderer: object, material: THREE.Material, source?: LuxUniforms): Binding {
  let materials = bindings.get(renderer);
  if (!materials) { materials = new WeakMap(); bindings.set(renderer, materials); }
  let binding = materials.get(material);
  if (!binding) {
    binding = { source: source ?? createLuxUniforms(), allow: { value: 1 }, shaderUniforms: {} };
    const retained = binding;
    for (const key of Object.keys(binding.source) as Array<keyof LuxUniforms>) {
      binding.shaderUniforms[key] = { get value() { return retained.source[key].value; } };
    }
    binding.shaderUniforms.luxAllowReflection = binding.allow;
    materials.set(material, binding);
  }
  if (source) binding.source = source;
  return binding;
}

// Reuse the renderer's GGX PMREM sampler, with its own atlas dimensions and names. The scene's
// HDRI and Lux's low-resolution cache usually have DIFFERENT atlas sizes; sharing CUBEUV_* breaks it.
const luxSampler = THREE.ShaderChunk.cube_uv_reflection_fragment
  .replace('#ifdef ENVMAP_TYPE_CUBE_UV', '#if 1')
  .replace(/\b(getFace|getUV|bilinearCubeUV|roughnessToMip|textureCubeUV|cubeUV_\w+)\b/g, 'lux_$1')
  .replace(/CUBEUV_TEXEL_WIDTH/g, 'luxAtlas.x')
  .replace(/CUBEUV_TEXEL_HEIGHT/g, 'luxAtlas.y')
  .replace(/CUBEUV_MAX_MIP/g, 'luxAtlas.z');
const declarations = /* glsl */ `
uniform float luxActive;
uniform vec3 luxOrigin;
uniform float luxRadius;
uniform vec3 luxSH[9];
uniform float luxIndirect;
uniform sampler2D luxReflection;
uniform float luxReflectionGain;
uniform float luxAllowReflection;
uniform vec3 luxAtlas;
float luxWeight() {
  vec3 worldPosition = cameraPosition + (-vViewPosition * mat3(viewMatrix));
  return luxActive * (1.0 - smoothstep(luxRadius * 0.65, luxRadius, distance(worldPosition, luxOrigin)));
}
`;

/** Own only our shader hooks; never change an authored material's maps, colors or intensity. */
export class LuxMaterials {
  private records = new Map<THREE.Material, { restore: () => void; allow: { value: number } }>();
  constructor(readonly uniforms: LuxUniforms, readonly renderer: THREE.WebGLRenderer) {}

  sync(scene: THREE.Scene) {
    const live = new Set<THREE.Material>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!(material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial) continue;
        live.add(material);
        if (!this.records.has(material)) this.patch(material as THREE.MeshStandardMaterial);
        // Explicit material maps and the existing local reflection probes retain priority.
        this.records.get(material)!.allow.value = (material as THREE.MeshStandardMaterial).envMap ? 0 : 1;
      }
    });
    for (const [material, record] of this.records) if (!live.has(material)) {
      record.restore(); this.records.delete(material);
    }
  }

  private patch(material: THREE.MeshStandardMaterial) {
    const before = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey;
    const originalKey = cacheKey.call(material);
    const binding = bindingFor(this.renderer, material, this.uniforms);
    const allow = binding.allow;
    allow.value = material.envMap ? 0 : 1;
    const hook: THREE.Material['onBeforeCompile'] = function(shader, renderer) {
      before.call(material, shader, renderer);
      // A shared material can have a hook from another Canvas in its chain; patch it only once.
      if (shader.uniforms.luxActive) return;
      Object.assign(shader.uniforms, bindingFor(renderer, material).shaderUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <envmap_physical_pars_fragment>', declarations + luxSampler + '\n' + THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          'return envMapColor.rgb * envMapIntensity;',
          `float weight = luxWeight() * luxAllowReflection;
           if (weight > 0.0 && luxReflectionGain > 0.0) {
             return mix(envMapColor.rgb * envMapIntensity,
               lux_textureCubeUV(luxReflection, reflectVec, roughness).rgb * luxReflectionGain, weight);
           }
           return envMapColor.rgb * envMapIntensity;`,
        ))
        .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
          #if defined(RE_IndirectDiffuse)
            irradiance += max(vec3(0.0), getLightProbeIrradiance(luxSH, geometryNormal)) * luxIndirect * luxWeight();
          #endif`);
    };
    const key = () => `${cacheKey === THREE.Material.prototype.customProgramCacheKey ? originalKey : cacheKey.call(material)}|lux-1.0`;
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
    this.records.set(material, { allow, restore: () => {
      if (material.onBeforeCompile === hook) material.onBeforeCompile = before;
      if (material.customProgramCacheKey === key) material.customProgramCacheKey = cacheKey;
      material.needsUpdate = true;
    } });
  }

  dispose() {
    this.uniforms.luxActive.value = 0;
    for (const record of this.records.values()) record.restore();
    this.records.clear();
  }
}
