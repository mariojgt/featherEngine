import * as THREE from 'three';

export function surfaceWeatherUniforms() {
  return { featherWetness:{value:0}, featherPuddles:{value:0}, featherRain:{value:0}, featherWeatherTime:{value:0} };
}
export type SurfaceWeatherUniforms=ReturnType<typeof surfaceWeatherUniforms>;
type Binding={source:SurfaceWeatherUniforms;response:{value:number};uniforms:Record<string,{readonly value:unknown}>};
const bindings=new WeakMap<object,WeakMap<THREE.Material,Binding>>();
function bind(renderer:object,material:THREE.Material,source?:SurfaceWeatherUniforms) {
  let records=bindings.get(renderer);if(!records){records=new WeakMap();bindings.set(renderer,records);}
  let binding=records.get(material);
  if(!binding){
    binding={source:source??surfaceWeatherUniforms(),response:{value:1},uniforms:{}};
    const retained=binding;
    for(const key of Object.keys(binding.source) as Array<keyof SurfaceWeatherUniforms>) binding.uniforms[key]={get value(){return retained.source[key].value;}};
    binding.uniforms.featherWeatherResponse=binding.response;records.set(material,binding);
  }
  if(source)binding.source=source;
  return binding;
}

export const surfaceWeatherDeclarations=/* glsl */`
uniform float featherWetness, featherPuddles, featherRain, featherWeatherTime, featherWeatherResponse;
float featherWaterHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float featherWaterNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(featherWaterHash(i),featherWaterHash(i+vec2(1,0)),f.x),mix(featherWaterHash(i+vec2(0,1)),featherWaterHash(i+vec2(1,1)),f.x),f.y);
}
vec2 featherRainRipple(vec2 position){
  vec2 cell=floor(position),uv=fract(position),gradient=vec2(0.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 neighbour=vec2(float(x),float(y)),id=cell+neighbour;
    vec2 center=neighbour+vec2(featherWaterHash(id),featherWaterHash(id+19.3));
    vec2 delta=uv-center;float distanceToDrop=length(delta);
    float age=fract(featherWeatherTime*0.8+featherWaterHash(id+7.1));
    float ring=distanceToDrop-age*0.85;
    float wave=sin(ring*48.0)*exp(-ring*ring*160.0)*(1.0-age)*smoothstep(0.0,0.1,age);
    gradient+=delta/max(0.02,distanceToDrop)*wave;
  }
  return gradient;
}
`;
export const wetSurfaceShader=/* glsl */`
if(featherWetness*featherWeatherResponse>0.0001){
  vec3 wetWorldPosition=cameraPosition+(-vViewPosition*mat3(viewMatrix));
  vec3 wetWorldNormal=inverseTransformDirection(normal,viewMatrix);
  float upward=smoothstep(0.35,0.94,wetWorldNormal.y);
  float wet=clamp(featherWetness*featherWeatherResponse,0.0,1.0);
  float wetPattern=featherWaterNoise(wetWorldPosition.xz*0.32)*0.7+featherWaterNoise(wetWorldPosition.xz*1.3)*0.3;
  float puddle=smoothstep(1.0-featherPuddles,1.08-featherPuddles,wetPattern)*upward*wet;
  // Absorption darkens porous surfaces; metals keep their authored conductor response.
  #ifndef FEATHER_REFLECTION_BUFFER
  diffuseColor.rgb*=mix(1.0,0.58,wet*(1.0-metalnessFactor));
  #endif
  // Vertical facades are rain-darkened rather than flooded mirror planes.
  roughnessFactor=mix(roughnessFactor,min(roughnessFactor,mix(0.38,0.24,upward)),wet);
  roughnessFactor=mix(roughnessFactor,0.055,puddle);
  if(puddle*featherRain>0.001){
    vec2 ripple=featherRainRipple(wetWorldPosition.xz*1.8)*puddle*featherRain*0.075;
    wetWorldNormal=normalize(wetWorldNormal+vec3(ripple.x,0.0,ripple.y));
    normal=normalize(mat3(viewMatrix)*wetWorldNormal);
  }
}
`;

/** Share the exact material response with the reflection normal/roughness pass. */
export function reflectionWeatherUniforms(renderer: THREE.WebGLRenderer, material: THREE.Material) {
  return bind(renderer, material).uniforms;
}

/** Shader-only surface response: original colors, maps and roughness are never overwritten. */
export class SurfaceWeatherMaterials {
  private records=new Map<THREE.Material,()=>void>();
  constructor(readonly uniforms:SurfaceWeatherUniforms,readonly renderer:THREE.WebGLRenderer){}
  sync(scene:THREE.Scene){
    const live=new Set<THREE.Material>();
    scene.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const m=material as THREE.MeshPhysicalMaterial;
        if(!m?.isMeshStandardMaterial)continue;
        live.add(m);if(!this.records.has(m))this.patch(m);
        // Glass, cutout vegetation and deliberately excluded assets keep their own surface model.
        const response=typeof m.userData.weatherResponse==='number'?m.userData.weatherResponse:1;
        bind(this.renderer,m).response.value=m.transmission>0 || m.alphaTest>0 || m.transparent ? 0 : Math.max(0,Math.min(1,Number.isFinite(response)?response:1));
      }
    });
    for(const [material,restore] of this.records)if(!live.has(material)){restore();this.records.delete(material);}
  }
  private patch(material:THREE.MeshStandardMaterial){
    const before=material.onBeforeCompile,cacheKey=material.customProgramCacheKey,originalKey=cacheKey.call(material);
    bind(this.renderer,material,this.uniforms);
    const hook:THREE.Material['onBeforeCompile']=(shader,renderer)=>{
      before.call(material,shader,renderer);if(shader.uniforms.featherWetness)return;
      Object.assign(shader.uniforms,bind(renderer,material).uniforms);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+surfaceWeatherDeclarations)
        .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+wetSurfaceShader);
    };
    const key=()=>`${cacheKey===THREE.Material.prototype.customProgramCacheKey?originalKey:cacheKey.call(material)}|feather-weather-1`;
    material.onBeforeCompile=hook;material.customProgramCacheKey=key;material.needsUpdate=true;
    this.records.set(material,()=>{if(material.onBeforeCompile===hook)material.onBeforeCompile=before;if(material.customProgramCacheKey===key)material.customProgramCacheKey=cacheKey;material.needsUpdate=true;});
  }
  dispose(){this.uniforms.featherWetness.value=0;for(const restore of this.records.values())restore();this.records.clear();}
}
