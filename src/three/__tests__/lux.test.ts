import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { luxBudget, luxCoverage, resolveLux } from '../lux/settings';
import { createLuxUniforms, LuxMaterials } from '../lux/materials';
import { readLuxPixels, renderLuxFace } from '../lux/cache';

describe('Lux rendering contracts', () => {
  it('does not leave a pixel pack buffer bound while asynchronous GPU readback is pending', async () => {
    const context = { PIXEL_PACK_BUFFER: 1, PIXEL_PACK_BUFFER_BINDING: 2, getParameter: () => null, bindBuffer: vi.fn() };
    let finish!: () => void;
    const renderer = {
      getContext: () => context,
      readRenderTargetPixelsAsync: vi.fn(() => { context.bindBuffer(1, 'pending-read'); return new Promise<void>((done) => { finish = done; }); }),
    };
    const target = new THREE.WebGLCubeRenderTarget(16);
    const read = readLuxPixels(renderer as unknown as THREE.WebGLRenderer, target, 0, 0, 16, 16, new Uint8Array(16 * 16 * 4), 0);
    expect(context.bindBuffer).toHaveBeenLastCalledWith(1, null);
    finish(); await read; target.dispose();
  });
  it('keeps legacy scenes off and bounds untrusted settings and every quality tier', () => {
    expect(luxBudget(resolveLux())).toBeNull();
    const settings = resolveLux({ enabled: true, quality: 'cinematic', radius: Infinity, position: [NaN, 5, Infinity], indirectIntensity: 100, updateInterval: -1 });
    expect(settings.radius).toBe(24);
    expect(settings.position).toEqual([0, 5, 0]);
    expect(settings.indirectIntensity).toBe(3);
    expect(luxBudget(settings, 'Low')).toBeNull();
    expect(luxBudget(settings, 'Medium')).toMatchObject({ resolution: 32, interval: 1, faceStride: 2 });
    expect(luxBudget(settings, 'High')?.resolution).toBe(64);
    expect(luxBudget(settings, 'Epic')?.resolution).toBe(128);
    expect(luxBudget({ ...settings, quality: 'performance' }, 'Epic')?.resolution).toBe(32);
  });

  it('uses bounded continuous coverage instead of tinting the entire scene', () => {
    expect(luxCoverage(0, 20)).toBe(1);
    expect(luxCoverage(13, 20)).toBe(1);
    expect(luxCoverage(17, 20)).toBeGreaterThan(0);
    expect(luxCoverage(17, 20)).toBeLessThan(1);
    expect(luxCoverage(20, 20)).toBe(0);
    expect(luxCoverage(200, 20)).toBe(0);
  });

  it('chains material customizations, respects explicit maps and restores without destroying authored data', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    const custom = vi.fn();
    const key = () => 'wind';
    material.onBeforeCompile = custom; material.customProgramCacheKey = key;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const renderer = {} as THREE.WebGLRenderer;
    const uniforms = createLuxUniforms(); const manager = new LuxMaterials(uniforms, renderer);
    manager.sync(scene);
    const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as Parameters<THREE.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, renderer);
    expect(custom).toHaveBeenCalledOnce();
    uniforms.luxActive.value = 0.4;
    expect(shader.uniforms.luxActive.value).toBe(0.4);
    expect(material.customProgramCacheKey()).toBe('wind|lux-1.0');
    expect(shader.fragmentShader).toContain('lux_textureCubeUV');
    expect(shader.fragmentShader).toContain('getLightProbeIrradiance(luxSH');
    const map = new THREE.Texture(); material.envMap = map; material.envMapIntensity = 2;
    manager.sync(scene);
    expect(shader.uniforms.luxAllowReflection.value).toBe(0);
    manager.dispose();
    expect(material.onBeforeCompile).toBe(custom);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.envMap).toBe(map);
    expect(material.envMapIntensity).toBe(2);
    // Re-enabling can reuse the old compiled shader without calling onBeforeCompile again.
    const nextUniforms = createLuxUniforms(); const next = new LuxMaterials(nextUniforms, renderer);
    next.sync(scene); nextUniforms.luxActive.value = 0.8;
    expect(shader.uniforms.luxActive.value).toBe(0.8);
    const otherRenderer = {} as THREE.WebGLRenderer;
    const isolated = new LuxMaterials(createLuxUniforms(), otherRenderer); isolated.sync(scene);
    expect(shader.uniforms.luxActive.value).toBe(0.8);
    isolated.dispose(); next.dispose();
    material.dispose(); mesh.geometry.dispose(); map.dispose();
  });

  it('restores render targets, XR, viewport, helper visibility and capture gain after a render failure', () => {
    const scene = new THREE.Scene(); const helper = new THREE.Group();
    helper.userData.luxExclude = true; scene.add(helper);
    const active = { value: 0.7 }; const oldTarget = {};
    const viewport = new THREE.Vector4(1, 2, 300, 200), scissor = new THREE.Vector4(3, 4, 100, 100);
    const renderer = {
      getRenderTarget: () => oldTarget, getActiveCubeFace: () => 4, getActiveMipmapLevel: () => 2,
      getViewport: () => viewport, getScissor: () => scissor, getScissorTest: () => true,
      xr: { enabled: true }, autoClear: false, shadowMap: { autoUpdate: true, needsUpdate: true }, toneMapping: THREE.ACESFilmicToneMapping,
      setRenderTarget: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(),
      render: () => { expect(active.value).toBe(0); expect(helper.visible).toBe(false); throw new Error('render failed'); },
    };
    const target = new THREE.WebGLCubeRenderTarget(16);
    expect(() => renderLuxFace(renderer as unknown as THREE.WebGLRenderer, scene, new THREE.Camera(), target, 0, active)).toThrow('render failed');
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(oldTarget, 4, 2);
    expect(renderer.setViewport).toHaveBeenLastCalledWith(viewport);
    expect(renderer.setScissor).toHaveBeenLastCalledWith(scissor);
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(renderer.xr.enabled).toBe(true); expect(renderer.autoClear).toBe(false);
    expect(renderer.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(helper.visible).toBe(true); expect(active.value).toBe(0.7);
    target.dispose();
  });
});
