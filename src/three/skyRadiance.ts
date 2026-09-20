import * as THREE from 'three';
import type { QualityLevel, SceneEnvironmentSettings } from '../types';
import { sunDirectionFromEnvironment } from './environmentSettings';
import { skyVertexShader, skyFragmentShader } from './skyShader';
import { advanceWeatherDrift, type WeatherDrift } from './weatherMotion';

/** Filter the sky only, never the full world. The global quality tier bounds resolution and cadence. */
export function skyRadianceBudget(quality: QualityLevel = 'High') {
  return quality === 'Low' ? { resolution: 32, interval: 2 } : quality === 'Medium' ? { resolution: 64, interval: 1 } :
    quality === 'Epic' ? { resolution: 128, interval: 0.5 } : { resolution: 64, interval: 0.75 };
}

export class SkyRadiance {
  readonly world = new THREE.Scene();
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  readonly target: THREE.WebGLCubeRenderTarget;
  readonly camera: THREE.CubeCamera;
  readonly pmrem: THREE.PMREMGenerator;
  readonly status = { captures: 0, captureMs: 0 };
  filtered: THREE.WebGLRenderTarget | null = null;
  private drift: WeatherDrift = { x: 0, z: 0 };
  private lastTime = -Infinity;
  private lastKey = '';
  constructor(readonly renderer: THREE.WebGLRenderer, readonly quality: QualityLevel = 'High') {
    const budget = skyRadianceBudget(quality);
    this.target = new THREE.WebGLCubeRenderTarget(budget.resolution, {type: THREE.HalfFloatType, generateMipmaps:false, minFilter:THREE.LinearFilter});
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.CubeCamera(0.1, 600, this.target);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.material = new THREE.ShaderMaterial({vertexShader:skyVertexShader, fragmentShader:skyFragmentShader,
      side:THREE.BackSide, depthWrite:false, toneMapped:false, uniforms:{
        topColor:{value:new THREE.Color()},horizonColor:{value:new THREE.Color()},groundColor:{value:new THREE.Color()},
        sunColor:{value:new THREE.Color()},sunDirection:{value:new THREE.Vector3()},sunIntensity:{value:1},
        cloudCoverage:{value:0},cloudOffset:{value:new THREE.Vector2()},lightningFlash:{value:0},
      }});
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500,24,16),this.material);this.mesh.frustumCulled=false;this.world.add(this.mesh);
  }
  update(environment: SceneEnvironmentSettings, time: number): THREE.Texture | null {
    const u=this.material.uniforms, wind=environment.wind ?? [0,0,0], speed=environment.cloudSpeed ?? .35;
    advanceWeatherDrift(this.drift,time,(wind[0]*.015+.01)*speed,(wind[2]*.015+.004)*speed);
    // Light/weather edits recapture promptly; ordinary cloud drift obeys the quality budget.
    const key=JSON.stringify([environment.skyTopColor,environment.skyHorizonColor,environment.skyGroundColor,environment.sunColor,
      environment.sunIntensity,environment.sunAzimuth,environment.sunElevation,environment.cloudCoverage,environment.lightningFlash,environment.skyRotation]);
    const elapsed=time-this.lastTime;
    if (this.filtered && elapsed>=0 && !(elapsed===0 && key!==this.lastKey) && elapsed<(key===this.lastKey ? skyRadianceBudget(this.quality).interval : .1)) return this.filtered.texture;
    u.topColor.value.set(environment.skyTopColor);u.horizonColor.value.set(environment.skyHorizonColor);u.groundColor.value.set(environment.skyGroundColor);
    u.sunColor.value.set(environment.sunColor);u.sunDirection.value.copy(sunDirectionFromEnvironment(environment));u.sunIntensity.value=environment.sunIntensity;
    u.cloudCoverage.value=environment.cloudCoverage ?? 0;u.cloudOffset.value.set(this.drift.x,this.drift.z);u.lightningFlash.value=environment.lightningFlash ?? 0;
    this.mesh.rotation.y=THREE.MathUtils.degToRad(environment.skyRotation);
    const gl=this.renderer;
    const previous={target:gl.getRenderTarget(),face:gl.getActiveCubeFace(),mip:gl.getActiveMipmapLevel(),
      viewport:gl.getViewport(new THREE.Vector4()),scissor:gl.getScissor(new THREE.Vector4()),scissorTest:gl.getScissorTest(),
      xr:gl.xr.enabled,autoClear:gl.autoClear,toneMapping:gl.toneMapping,shadowAuto:gl.shadowMap.autoUpdate,shadowNeeds:gl.shadowMap.needsUpdate};
    const started=performance.now();
    try {
      gl.xr.enabled=false;gl.autoClear=true;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false;gl.toneMapping=THREE.NoToneMapping;gl.setScissorTest(false);
      this.camera.update(gl,this.world);
      this.filtered=this.pmrem.fromCubemap(this.target.texture,this.filtered ?? undefined);
      this.lastTime=time;this.lastKey=key;this.status.captures++;this.status.captureMs=performance.now()-started;
    } finally {
      gl.xr.enabled=previous.xr;gl.autoClear=previous.autoClear;gl.toneMapping=previous.toneMapping;gl.shadowMap.autoUpdate=previous.shadowAuto;gl.shadowMap.needsUpdate=previous.shadowNeeds;
      gl.setRenderTarget(previous.target,previous.face,previous.mip);gl.setViewport(previous.viewport);gl.setScissor(previous.scissor);gl.setScissorTest(previous.scissorTest);
    }
    return this.filtered.texture;
  }
  dispose() { this.mesh.geometry.dispose();this.material.dispose();this.target.dispose();this.filtered?.dispose();this.pmrem.dispose(); }
}
