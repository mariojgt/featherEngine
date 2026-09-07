import * as THREE from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import type { LuxSettings } from '../../types';
import type { LuxBudget } from './settings';
import { createLuxUniforms, LuxMaterials } from './materials';

export interface LuxStatus {
  state: 'warming' | 'capturing' | 'ready' | 'error';
  captures: number; faces: number; captureMs: number; hdr: boolean; resolution: number;
  position: number[]; error?: string;
}
const statuses = new Map<string, LuxStatus>();
export const getLuxStatus = (sceneId: string): LuxStatus | undefined => statuses.get(sceneId);

/** Three r171 leaves PIXEL_PACK_BUFFER bound while its async fence is pending. Detach it after
 * submission so synchronous pixel readers (picking, screenshots, other effects) keep working. */
export function readLuxPixels(renderer: THREE.WebGLRenderer, ...args: Parameters<THREE.WebGLRenderer['readRenderTargetPixelsAsync']>) {
  const context = renderer.getContext() as WebGL2RenderingContext; // Three r171 requires WebGL2.
  const previousPack = context.getParameter(context.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
  try { return renderer.readRenderTargetPixelsAsync(...args); }
  finally { context.bindBuffer(context.PIXEL_PACK_BUFFER, previousPack); }
}

function readIrradiance(renderer: THREE.WebGLRenderer, target: THREE.WebGLCubeRenderTarget) {
  // Scope the workaround to Lux; never replace a shared renderer method or patch Three globally.
  const reader = Object.create(renderer) as THREE.WebGLRenderer;
  reader.readRenderTargetPixelsAsync = (...args) => readLuxPixels(renderer, ...args);
  return LightProbeGenerator.fromCubeRenderTarget(reader, target);
}

/** A single capture face, with an exact renderer-state restore even if a material throws. */
export function renderLuxFace(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  target: THREE.WebGLCubeRenderTarget, face: number, capturing: { value: number },
) {
  const previous = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), xr: renderer.xr.enabled, autoClear: renderer.autoClear,
    shadow: renderer.shadowMap.autoUpdate, shadowNeedsUpdate: renderer.shadowMap.needsUpdate,
    toneMapping: renderer.toneMapping, active: capturing.value,
  };
  const hidden: THREE.Object3D[] = [];
  try {
    capturing.value = 0; // Never feed the last indirect result back into its own capture.
    scene.traverse((object) => {
      if (object.visible && (object.userData.luxExclude || (object as THREE.LightProbe).isLightProbe)) {
        hidden.push(object); object.visible = false;
      }
    });
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target, face, 0);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
  } finally {
    for (const object of hidden) object.visible = true;
    capturing.value = previous.active;
    renderer.xr.enabled = previous.xr;
    renderer.autoClear = previous.autoClear;
    renderer.shadowMap.autoUpdate = previous.shadow;
    renderer.shadowMap.needsUpdate = previous.shadowNeedsUpdate;
    renderer.toneMapping = previous.toneMapping;
    renderer.setRenderTarget(previous.target, previous.face, previous.mip);
    renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);
  }
}

/** GPU resources and shader hooks belong to ONE Canvas. No global shader or environment mutation. */
export class LuxCache {
  readonly uniforms = createLuxUniforms();
  readonly materials: LuxMaterials;
  readonly status: LuxStatus;
  private target: THREE.WebGLCubeRenderTarget;
  private cube: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private filtered: THREE.WebGLRenderTarget | null = null;
  private desiredSH = new THREE.SphericalHarmonics3();
  private origin = new THREE.Vector3();
  private requestedOrigin = new THREE.Vector3();
  private frame = 0;
  private face = -1;
  private nextCapture = 0;
  private nextMaterialScan = 0;
  private busy = false;
  private disposed = false;
  private ready = false;
  private nonce = -1;
  private captureCost = 0;

  constructor(
    readonly gl: THREE.WebGLRenderer, readonly scene: THREE.Scene,
    readonly sceneId: string, readonly budget: LuxBudget,
  ) {
    this.materials = new LuxMaterials(this.uniforms, gl);
    const hdr = gl.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLCubeRenderTarget(budget.resolution, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.target.texture.mapping = THREE.CubeReflectionMapping;
    this.cube = new THREE.CubeCamera(0.1, 250, this.target);
    this.cube.coordinateSystem = gl.coordinateSystem;
    this.cube.updateCoordinateSystem();
    this.pmrem = new THREE.PMREMGenerator(gl);
    this.status = { state: 'warming', captures: 0, faces: 0, captureMs: 0, hdr, resolution: budget.resolution, position: [0, 0, 0] };
    statuses.set(sceneId, this.status);
  }

  update(camera: THREE.Camera, settings: LuxSettings, elapsed: number, dt: number) {
    if (this.disposed || this.status.state === 'error') return;
    const u = this.uniforms;
    u.luxIndirect.value = settings.indirectIntensity;
    u.luxRadius.value = settings.radius;
    u.luxReflectionGain.value = settings.reflections && this.status.hdr && this.filtered ? settings.reflectionIntensity : 0;
    if (settings.mode === 'camera') camera.getWorldPosition(this.requestedOrigin);
    else this.requestedOrigin.fromArray(settings.position);
    // Invalidate after a teleport instead of dragging the previous room's light into the next room.
    if (this.ready && this.requestedOrigin.distanceTo(u.luxOrigin.value) > settings.radius * 0.5) {
      this.ready = false; u.luxActive.value = 0; this.nextCapture = 0;
    }
    if (this.nonce !== settings.refreshNonce) {
      this.nonce = settings.refreshNonce; this.nextCapture = 0;
    }
    if (elapsed >= this.nextMaterialScan) {
      this.materials.sync(this.scene); this.nextMaterialScan = elapsed + 0.5;
    }
    if (this.ready) {
      const blend = settings.smoothing > 0 ? 1 - Math.exp(-Math.min(dt, 0.1) / settings.smoothing) : 1;
      u.luxSH.value.forEach((coefficient, i) => coefficient.lerp(this.desiredSH.coefficients[i], blend));
      u.luxActive.value = Math.min(1, u.luxActive.value + dt * 4);
    }
    if (this.busy) return; // Do not overwrite any face while asynchronous readback is in flight.
    this.frame += 1;
    if (this.frame < 3 || this.frame % this.budget.faceStride !== 0) return;
    if (this.face < 0) {
      if (elapsed < this.nextCapture) return;
      this.origin.copy(this.requestedOrigin);
      this.cube.position.copy(this.origin);
      this.cube.updateMatrixWorld(true);
      this.face = 0; this.captureCost = 0;
      if (!this.ready) this.status.state = 'capturing';
    }
    const started = performance.now();
    try {
      const faceCamera = this.cube.children[this.face] as THREE.PerspectiveCamera;
      faceCamera.layers.mask = camera.layers.mask;
      renderLuxFace(this.gl, this.scene, faceCamera, this.target, this.face, u.luxActive);
      this.captureCost += performance.now() - started;
      this.face += 1; this.status.faces += 1;
      if (this.face < 6) return; // Hard budget: at most ONE scene face per animation frame.
      this.face = -1;
      this.nextCapture = elapsed + Math.max(this.budget.interval, settings.updateInterval);
      this.busy = true;
      // SH integration/readback is asynchronous; publication is atomic after ALL six faces finish.
      void readIrradiance(this.gl, this.target).then((probe) => {
        if (this.disposed) return;
        const startFilter = performance.now();
        // A bright emissive pixel must not make the entire cache diverge. Preserve hue/direction.
        const dc = probe.sh.coefficients[0];
        const peak = Math.max(dc.x, dc.y, dc.z) * 0.282095;
        if (peak > 8) probe.sh.scale(8 / peak);
        // PMREM's internal blur targets require HDR. LDR devices still receive diffuse SH lighting
        // and retain their authored reflections instead of attempting unsupported float targets.
        const next = settings.reflections && this.status.hdr ? this.pmrem.fromCubemap(this.target.texture, this.filtered ?? undefined) : null;
        if (!next) this.filtered?.dispose();
        this.filtered = next;
        this.desiredSH.copy(probe.sh);
        if (!this.ready || this.origin.distanceTo(u.luxOrigin.value) > settings.radius * 0.25) {
          u.luxSH.value.forEach((coefficient, i) => coefficient.copy(probe.sh.coefficients[i]));
        }
        u.luxOrigin.value.copy(this.origin);
        u.luxReflection.value = next?.texture ?? null;
        if (next) u.luxAtlas.value.set(1 / next.width, 1 / next.height, Math.log2(this.budget.resolution));
        this.ready = true;
        this.status.state = 'ready'; this.status.captures += 1;
        this.status.captureMs = this.captureCost + performance.now() - startFilter;
        this.status.position = this.origin.toArray();
      }).catch((error: unknown) => this.fail(error)).finally(() => {
        this.busy = false;
        if (this.disposed) this.releaseTargets();
      });
    } catch (error) { this.fail(error); }
  }

  private fail(error: unknown) {
    if (this.disposed) return;
    this.uniforms.luxActive.value = 0;
    this.status.state = 'error';
    this.status.error = error instanceof Error ? error.message : String(error);
    console.warn('[Lux 1.0] Using authored lighting after capture failure:', this.status.error);
  }
  private releaseTargets() { this.filtered?.dispose(); this.target.dispose(); this.pmrem.dispose(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.materials.dispose();
    if (statuses.get(this.sceneId) === this.status) statuses.delete(this.sceneId);
    // WebGL readback owns the target until its promise settles; never dispose underneath it.
    if (!this.busy) this.releaseTargets();
  }
}
