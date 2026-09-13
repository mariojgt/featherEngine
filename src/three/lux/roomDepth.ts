import * as THREE from 'three';

/** CubeCamera and PMREM use different face orderings. The atlas follows PMREM's getFace/getUV. */
export const LUX_DEPTH_COLUMNS = [0, 3, 1, 4, 2, 5];

/** One small atlas holds depth for all four rooms, costing a single material texture sampler. */
export class LuxRoomDepth {
  readonly target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private cubeTarget = new THREE.WebGLCubeRenderTarget(1);
  private camera = new THREE.CubeCamera(0.1, 250, this.cubeTarget);

  constructor(readonly gl: THREE.WebGLRenderer, readonly resolution: number) {
    this.target = new THREE.WebGLRenderTarget(resolution * 6, resolution * 4, {
      type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.distanceRGBA.uniforms),
      vertexShader: THREE.ShaderLib.distanceRGBA.vertexShader,
      fragmentShader: THREE.ShaderLib.distanceRGBA.fragmentShader,
      side: THREE.DoubleSide,
    });
    this.material.uniforms.nearDistance.value = 0;
    this.material.uniforms.farDistance.value = 250;
    this.camera.coordinateSystem = gl.coordinateSystem;
    this.camera.updateCoordinateSystem();
  }

  render(scene: THREE.Scene, viewer: THREE.Camera, origin: THREE.Vector3, room: number, face: number) {
    const gl = this.gl;
    const previous = {
      target: gl.getRenderTarget(), face: gl.getActiveCubeFace(), mip: gl.getActiveMipmapLevel(),
      viewport: gl.getViewport(new THREE.Vector4()), scissor: gl.getScissor(new THREE.Vector4()),
      scissorTest: gl.getScissorTest(), color: gl.getClearColor(new THREE.Color()), alpha: gl.getClearAlpha(),
      autoClear: gl.autoClear, xr: gl.xr.enabled, toneMapping: gl.toneMapping,
      shadow: gl.shadowMap.autoUpdate, shadowNeedsUpdate: gl.shadowMap.needsUpdate,
      material: scene.overrideMaterial, background: scene.background,
    };
    const hidden: THREE.Object3D[] = [];
    try {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const materials = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        if (object.visible && (object.userData.luxExclude || (mesh.isMesh && (
          !mesh.frustumCulled || materials.every((m) => m.transparent || m.opacity < 1)
        )) || (object as THREE.Line).isLine || (object as THREE.Points).isPoints)) {
          hidden.push(object); object.visible = false;
        }
      });
      this.camera.position.copy(origin); this.camera.updateMatrixWorld(true);
      const camera = this.camera.children[face] as THREE.PerspectiveCamera;
      camera.layers.mask = viewer.layers.mask;
      this.material.uniforms.referencePosition.value.copy(origin);
      scene.overrideMaterial = this.material; scene.background = null;
      gl.xr.enabled = false; gl.autoClear = true; gl.toneMapping = THREE.NoToneMapping;
      gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = false;
      gl.setRenderTarget(this.target);
      const x = LUX_DEPTH_COLUMNS[face] * this.resolution, y = room * this.resolution;
      gl.setViewport(x, y, this.resolution, this.resolution);
      gl.setScissor(x, y, this.resolution, this.resolution); gl.setScissorTest(true);
      gl.setClearColor(0xffffff, 1);
      gl.render(scene, camera);
    } finally {
      hidden.forEach((object) => { object.visible = true; });
      scene.overrideMaterial = previous.material; scene.background = previous.background;
      gl.xr.enabled = previous.xr; gl.autoClear = previous.autoClear; gl.toneMapping = previous.toneMapping;
      gl.shadowMap.autoUpdate = previous.shadow; gl.shadowMap.needsUpdate = previous.shadowNeedsUpdate;
      gl.setRenderTarget(previous.target, previous.face, previous.mip);
      gl.setViewport(previous.viewport); gl.setScissor(previous.scissor); gl.setScissorTest(previous.scissorTest);
      gl.setClearColor(previous.color, previous.alpha);
    }
  }

  dispose() { this.target.dispose(); this.cubeTarget.dispose(); this.material.dispose(); }
}
