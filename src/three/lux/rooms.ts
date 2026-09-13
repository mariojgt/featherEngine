import * as THREE from 'three';
import type { LuxRoom, LuxSettings } from '../../types';
import { LuxCache, publishLuxStatus, removeLuxStatus, type LuxStatus } from './cache';
import { createLuxUniforms, LuxMaterials } from './materials';
import { LuxRoomDepth } from './roomDepth';
import type { LuxBudget } from './settings';

/** All rooms share ONE scene-render budget, including depth capture. */
export class LuxRooms {
  readonly uniforms = createLuxUniforms();
  readonly status: LuxStatus;
  private materials: LuxMaterials;
  private depth: LuxRoomDepth;
  private slots: Array<{ room: LuxRoom; cache: LuxCache; depthFace: number; depthReady: boolean; lastCapture: number }>;
  private owner = 0;
  private frame = 0;
  private nextScan = 0;
  private disposed = false;

  constructor(readonly gl: THREE.WebGLRenderer, readonly scene: THREE.Scene, readonly sceneId: string, readonly budget: LuxBudget, rooms: LuxRoom[]) {
    this.materials = new LuxMaterials(this.uniforms, gl);
    this.depth = new LuxRoomDepth(gl, budget.resolution);
    this.uniforms.luxRoomDepth.value = this.depth.target.texture;
    this.uniforms.luxRoomDepthResolution.value = budget.resolution;
    this.uniforms.luxRoomCount.value = rooms.length;
    // Stride is enforced by the shared scheduler, rather than multiplied by the number of rooms.
    this.slots = rooms.map((room, i) => ({
      room, cache: new LuxCache(gl, scene, `${sceneId}/lux-room/${room.id}`, { ...budget, faceStride: 1 }, { active: this.uniforms.luxActive }),
      depthFace: -1, depthReady: false, lastCapture: 0,
    }));
    this.status = { state: 'warming', captures: 0, faces: 0, captureMs: 0, hdr: gl.extensions.has('EXT_color_buffer_float'), resolution: budget.resolution, position: [0, 0, 0], rooms: [] };
    publishLuxStatus(sceneId, this.status);
    rooms.forEach((room, i) => {
      const center = new THREE.Vector3().fromArray(room.center), half = new THREE.Vector3().fromArray(room.size).multiplyScalar(0.5);
      this.uniforms.luxRoomMin.value[i].copy(center).sub(half);
      this.uniforms.luxRoomMax.value[i].copy(center).add(half);
      this.uniforms.luxRoomBlend.value.setComponent(i, room.blendDistance);
    });
  }

  update(camera: THREE.Camera, settings: LuxSettings, elapsed: number, dt: number) {
    if (this.disposed) return;
    const u = this.uniforms;
    if (elapsed >= this.nextScan) { this.materials.sync(this.scene); this.nextScan = elapsed + 0.5; }
    u.luxIndirect.value = settings.indirectIntensity;
    u.luxRoomOcclusion.value = settings.roomOcclusion ? 1 : 0;
    const captureFrame = ++this.frame % this.budget.faceStride === 0;
    // Finish the current batch. Otherwise choose the next due room, round-robin without starvation.
    if (this.slots.length && !this.slots[this.owner].cache.capturing && this.slots[this.owner].depthFace < 0) {
      for (let n = 1; n <= this.slots.length; n++) {
        const index = (this.owner + n) % this.slots.length;
        if (this.slots[index].depthFace >= 0 || this.slots[index].cache.canCapture(elapsed)) { this.owner = index; break; }
      }
    }
    this.slots.forEach((slot, i) => {
      const { cache, room } = slot;
      const before = cache.status.faces;
      const ownsFrame = captureFrame && this.owner === i;
      cache.update(camera, { ...settings, mode: 'fixed', position: room.capturePosition ?? room.center, radius: Math.min(200, Math.hypot(...room.size)) }, elapsed, dt, ownsFrame && slot.depthFace < 0);
      this.status.faces += cache.status.faces - before;
      if (cache.status.captures > slot.lastCapture) {
        slot.lastCapture = cache.status.captures;
        if (settings.roomOcclusion) slot.depthFace = 0;
      }
      if (ownsFrame && slot.depthFace >= 0 && cache.status.faces === before) {
        try {
          const start = performance.now();
          this.depth.render(this.scene, camera, cache.uniforms.luxOrigin.value, i, slot.depthFace);
          this.status.captureMs = performance.now() - start;
          this.status.faces++;
          if (++slot.depthFace === 6) { slot.depthFace = -1; slot.depthReady = true; }
        } catch (error) {
          cache.status.state = 'error'; cache.status.error = error instanceof Error ? error.message : String(error);
          slot.depthFace = -1; slot.depthReady = false;
        }
      }
      const source = cache.uniforms;
      u.luxRoomReady.value.setComponent(i, cache.status.state === 'error' || (settings.roomOcclusion && !slot.depthReady) ? 0 : source.luxActive.value);
      u.luxRoomOrigins.value[i].copy(source.luxOrigin.value);
      u[`luxRoomSH${i as 0 | 1 | 2 | 3}`].value = source.luxSH.value;
      u[`luxRoomReflection${i as 0 | 1 | 2 | 3}`].value = source.luxReflection.value;
      u.luxRoomReflectionGains.value.setComponent(i, source.luxReflectionGain.value);
      if (source.luxReflection.value) u.luxAtlas.value.copy(source.luxAtlas.value);
    });
    u.luxActive.value = 1;
    this.status.captures = this.slots.reduce((n, s) => n + s.cache.status.captures, 0);
    this.status.rooms = this.slots.map((s, i) => ({ id: s.room.id, name: s.room.name, captures: s.cache.status.captures, state: s.cache.status.state === 'error' ? 'error' : u.luxRoomReady.value.getComponent(i) > 0 ? 'ready' : 'capturing' }));
    this.status.state = !this.slots.length ? 'warming' : this.status.rooms.every((s) => s.state === 'ready') ? 'ready' : this.status.rooms.every((s) => s.state === 'error') ? 'error' : 'capturing';
    this.status.error = this.slots.find((s) => s.cache.status.error)?.cache.status.error;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.materials.dispose(); this.slots.forEach((s) => s.cache.dispose()); this.depth.dispose();
    removeLuxStatus(this.sceneId, this.status);
  }
}
