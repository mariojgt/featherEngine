import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { installReflectionCompatibility, ReflectionHistory, reflectionTraceOptions } from '../reflectionCompatibility';
import { SurfaceWeatherMaterials, surfaceWeatherUniforms } from '../surfaceWeatherMaterials';

it('keeps reflection normals, wetness, and texture transforms synchronized without new materials per frame', () => {
  const renderer = {} as THREE.WebGLRenderer;
  const texture = new THREE.Texture(); texture.repeat.set(3, 2);
  const source = new THREE.MeshStandardMaterial({ roughness: 0, normalMap: texture, roughnessMap: texture, map: texture, alphaTest: .3 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
  const scene = new THREE.Scene(); scene.add(mesh);
  const uniforms = surfaceWeatherUniforms();
  const weather = new SurfaceWeatherMaterials(uniforms, renderer); weather.sync(scene);
  const material = new THREE.ShaderMaterial({
    uniforms: { roughness: new THREE.Uniform(0) },
    vertexShader: '#if defined(FLAT_SHADED) || defined(USE_BUMPMAP) || defined(TANGENTSPACE_NORMALMAP)\nvarying vec3 vViewPosition;\n#endif',
    fragmentShader: '#include <packing>\nvec3 normalColor = packNormalToRGB(normal);',
  });
  const disposed = vi.fn(); material.addEventListener('dispose', disposed);
  const reflection = new THREE.ShaderMaterial({ fragmentShader: 'vec3 iblRadiance = getIBLRadiance(-viewDir, viewNormal, 0.0) * fresnelFactor;' });
  const pass = { fullscreenMaterial: reflection, setMRTMaterialInScene: vi.fn(), dispose: vi.fn(), visibleMeshes: [mesh],
    cachedMaterials: new WeakMap([[mesh, [source, material] as [THREE.Material, THREE.ShaderMaterial]]]) };
  const effect = { reflectionsPass: pass };
  installReflectionCompatibility(effect, renderer);
  expect(effect).toMatchObject(reflectionTraceOptions);
  const installed = pass.setMRTMaterialInScene;
  installReflectionCompatibility(effect, renderer); expect(pass.setMRTMaterialInScene).toBe(installed);
  pass.setMRTMaterialInScene(); const version = material.version;
  uniforms.featherWetness.value = .8;
  expect(material.uniforms.featherWetness.value).toBe(.8);
  expect(material.uniforms.normalMapTransform.value).toEqual(texture.matrix);
  expect(material.uniforms.roughnessMapTransform.value).toEqual(texture.matrix);
  expect(material.uniforms.map.value).toBe(texture);
  expect(material.uniforms.alphaTest.value).toBe(.3);
  expect(reflection.fragmentShader).toContain('vec3 iblRadiance = vec3(0.0)');
  expect(material.uniforms.roughness.value).toBe(0);
  expect(material.vertexShader).toContain('#if 1\nvarying vec3 vViewPosition');
  expect(material.fragmentShader).toContain('FEATHER_REFLECTION_BUFFER');
  expect(material.fragmentShader).toContain('roughnessFactor=mix');
  pass.setMRTMaterialInScene(); expect(material.version).toBe(version);
  weather.dispose(); expect(material.uniforms.featherWetness.value).toBe(0);
  pass.dispose(); expect(disposed).toHaveBeenCalledOnce();
  mesh.geometry.dispose(); source.dispose(); texture.dispose(); reflection.dispose();
});

it('rejects reflection history across camera cuts, projection changes and parented teleports', () => {
  const history = new ReflectionHistory(), camera = new THREE.PerspectiveCamera(55, 1, .1, 100);
  const rig = new THREE.Group(); rig.add(camera);
  expect(history.update(camera)).toBe(true);
  expect(history.update(camera)).toBe(false);
  camera.position.x += .04;
  expect(history.update(camera)).toBe(false);
  rig.position.x += 20;
  expect(history.update(camera)).toBe(true);
  expect(history.update(camera)).toBe(false);
  camera.rotation.y += Math.PI / 2;
  expect(history.update(camera)).toBe(true);
  camera.fov = 40; camera.updateProjectionMatrix();
  expect(history.update(camera)).toBe(true);
  expect(history.update(camera)).toBe(false);
});

it('restores shadow update state even if a reflection render throws', () => {
  const renderer = { shadowMap: { autoUpdate: true, needsUpdate: true } } as THREE.WebGLRenderer;
  const effect = { reflectionsPass: { setMRTMaterialInScene() {}, dispose() {}, visibleMeshes: [], cachedMaterials: new WeakMap() },
    update() { expect(renderer.shadowMap.autoUpdate).toBe(false); expect(renderer.shadowMap.needsUpdate).toBe(false); throw new Error('render failed'); } };
  installReflectionCompatibility(effect, renderer);
  expect(() => effect.update()).toThrow('render failed');
  expect(renderer.shadowMap.autoUpdate).toBe(true); expect(renderer.shadowMap.needsUpdate).toBe(true);
});
