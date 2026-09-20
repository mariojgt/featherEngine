import { expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveLight } from '../lightSettings';
import { advanceSurfaceWater } from '../surfaceWeatherClock';
import { SurfaceWeatherMaterials, surfaceWeatherUniforms } from '../surfaceWeatherMaterials';
import { createLuxUniforms, LuxMaterials } from '../lux/materials';
import { skyRadianceBudget } from '../skyRadiance';
import { withSceneEnvironmentDefaults } from '../environmentSettings';

it('preserves legacy aiming and penumbra while sharing bounded light/shadow settings', () => {
  expect(resolveLight({type:'spot'},'High')).toMatchObject({useRotation:false,penumbra:.45,shadowSize:1024,decay:2});
  expect(resolveLight({type:'spot',penumbra:.8,useRotation:true},'Medium')).toMatchObject({penumbra:.8,useRotation:true,shadowSize:512});
  expect(resolveLight({castShadow:true},'Low').castShadow).toBe(false);
  expect(resolveLight({type:'rect',castShadow:true,width:NaN,height:-1,intensity:Infinity},'Epic')).toMatchObject({castShadow:false,width:4,height:.01,intensity:2.4});
  expect(resolveLight({shadowNear:30,shadowFar:2}).shadowFar).toBeGreaterThan(30);
});

it('accumulates and dries rain water with stable timing, pauses, and resets on replay', () => {
  const amounts=[];
  for(const fps of [24,60,120]){
    const state={water:0};advanceSurfaceWater(state,0,1,true);
    for(let i=1;i<=fps*10;i++)advanceSurfaceWater(state,i/fps,1,true);
    const wet=state.water;expect(advanceSurfaceWater(state,10,1,true)).toBe(wet);
    expect(wet).toBeCloseTo(1-Math.exp(-1.8),10);
    advanceSurfaceWater(state,20,0,true);expect(state.water).toBeLessThan(wet);expect(state.water).toBeGreaterThan(.5);
    amounts.push(state.water);expect(advanceSurfaceWater(state,0,1,true)).toBe(0);
  }
  expect(amounts[0]).toBeCloseTo(amounts[2],10);
});

it('keeps old projects dry with studio reflections and bounds quality budgets', () => {
  expect(withSceneEnvironmentDefaults()).toMatchObject({skyLighting:'studio',surfaceWetness:0,puddleCoverage:0,wetnessFromRain:false});
  expect(withSceneEnvironmentDefaults({surfaceWetness:NaN,puddleCoverage:4})).toMatchObject({surfaceWetness:0,puddleCoverage:1});
  expect(skyRadianceBudget('Low')).toEqual({resolution:32,interval:2});
  expect(skyRadianceBudget('Epic')).toEqual({resolution:128,interval:.5});
});

it('composes wet surfaces with Lux without changing authored material values, and retargets cached uniforms', () => {
  const scene=new THREE.Scene(),renderer={} as THREE.WebGLRenderer;
  const mat=new THREE.MeshPhysicalMaterial({color:'#987654',roughness:.85,metalness:.2,clearcoat:.3});
  const hook=mat.onBeforeCompile,key=mat.customProgramCacheKey;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),mat);scene.add(mesh);
  const original=mat.toJSON();
  const u=surfaceWeatherUniforms(),weather=new SurfaceWeatherMaterials(u,renderer);weather.sync(scene);
  const lux=new LuxMaterials(createLuxUniforms(),renderer);lux.sync(scene);
  const shader={uniforms:{},fragmentShader:THREE.ShaderLib.physical.fragmentShader} as Parameters<THREE.Material['onBeforeCompile']>[0];
  mat.onBeforeCompile(shader,renderer);u.featherWetness.value=.7;
  expect(shader.uniforms.featherWetness.value).toBe(.7);expect(shader.uniforms.luxActive).toBeDefined();
  expect(shader.fragmentShader).toContain('featherRainRipple');
  expect(mat.toJSON()).toEqual(original);
  lux.dispose();weather.dispose();expect(mat.onBeforeCompile).toBe(hook);expect(mat.customProgramCacheKey).toBe(key);
  const next=surfaceWeatherUniforms(),manager=new SurfaceWeatherMaterials(next,renderer);manager.sync(scene);next.featherWetness.value=.4;
  expect(shader.uniforms.featherWetness.value).toBe(.4);
  const other=new SurfaceWeatherMaterials(surfaceWeatherUniforms(),{} as THREE.WebGLRenderer);other.sync(scene);
  expect(shader.uniforms.featherWetness.value).toBe(.4);
  other.dispose();manager.dispose();mesh.geometry.dispose();mat.dispose();
});

it('does not coat transparent glass, cutout foliage, or materials with an authored weather exclusion', () => {
  const scene=new THREE.Scene(),renderer={} as THREE.WebGLRenderer;
  const materials=[new THREE.MeshPhysicalMaterial({transmission:1}),new THREE.MeshStandardMaterial({alphaTest:.5}),new THREE.MeshStandardMaterial()];
  materials[2].userData.weatherResponse=0;
  const geometry=new THREE.BoxGeometry();materials.forEach(m=>scene.add(new THREE.Mesh(geometry,m)));
  const manager=new SurfaceWeatherMaterials(surfaceWeatherUniforms(),renderer);manager.sync(scene);
  for(const mat of materials){const shader={uniforms:{},fragmentShader:THREE.ShaderLib.standard.fragmentShader} as Parameters<THREE.Material['onBeforeCompile']>[0];mat.onBeforeCompile(shader,renderer);expect(shader.uniforms.featherWeatherResponse.value).toBe(0);}
  manager.dispose();geometry.dispose();materials.forEach(m=>m.dispose());
});
