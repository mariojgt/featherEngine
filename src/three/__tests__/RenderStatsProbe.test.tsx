import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectionalLight, Mesh, Scene, type WebGLRenderer } from 'three';
import { getPerfSnapshot } from '../../runtime/perfStats';
import { RenderStatsProbe } from '../RenderStatsProbe';

const fiber = vi.hoisted(() => ({ state: {} as Record<string, unknown>, frame: () => {} }));
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: Record<string, unknown>) => unknown) => selector(fiber.state),
  useFrame: (callback: () => void) => { fiber.frame = callback; },
}));

describe('render statistics lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let now: number;
  let nextCalls: number;
  let nextTriangles: number;
  let renderer: ReturnType<typeof makeRenderer>;
  const makeRenderer = (autoReset = true) => ({
    info: { autoReset, render: { calls: 0, triangles: 0 }, programs: [1, 2], memory: { geometries: 3, textures: 4 } },
    render: vi.fn(function (this: unknown) {
      expect(this).toBe(renderer);
      renderer.info.render.calls = (renderer.info.autoReset ? 0 : renderer.info.render.calls) + nextCalls;
      renderer.info.render.triangles = (renderer.info.autoReset ? 0 : renderer.info.render.triangles) + nextTriangles;
      now += 2;
    }),
  });
  const renderPass = (calls: number, triangles: number) => {
    nextCalls = calls; nextTriangles = triangles;
    renderer.render();
  };
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    now = 1; nextCalls = nextTriangles = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    renderer = makeRenderer();
    const scene = new Scene();
    const light = new DirectionalLight(); light.castShadow = true;
    const mesh = new Mesh(); mesh.castShadow = true;
    scene.add(light, mesh);
    fiber.state = { gl: renderer as unknown as WebGLRenderer, scene };
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  it('counts all scene/post-processing renders once and samples scene costs', () => {
    act(() => root.render(<RenderStatsProbe />));
    renderPass(12, 360); renderPass(1, 1);
    act(() => fiber.frame());
    expect(getPerfSnapshot().render).toEqual({
      calls: 13, triangles: 361, programs: 2, geometries: 3, textures: 4,
      lights: 1, shadowLights: 1, shadowCasters: 1, skinned: 0,
    });
    expect(getPerfSnapshot().renderMs.last).toBe(4);
    act(() => fiber.frame());
    expect(getPerfSnapshot().render.calls).toBe(0);
    expect(getPerfSnapshot().renderMs.last).toBe(0);
  });

  it('handles cumulative renderer counters without multiplying the draw count', () => {
    renderer.info.autoReset = false;
    renderer.info.render.calls = 100;
    renderer.info.render.triangles = 2000;
    act(() => root.render(<RenderStatsProbe />));
    renderPass(12, 360); renderPass(1, 1);
    act(() => fiber.frame());
    expect(getPerfSnapshot().render.calls).toBe(13);
    expect(getPerfSnapshot().render.triangles).toBe(361);
  });

  it('restores the exact render function and drops old Canvas samples when switching to Play', () => {
    const editorRender = renderer.render;
    act(() => root.render(<RenderStatsProbe />));
    renderPass(42, 1000); act(() => fiber.frame());
    expect(getPerfSnapshot().renderMs.avg).toBe(2);
    act(() => root.render(null));
    expect(renderer.render).toBe(editorRender);
    expect(getPerfSnapshot().render.calls).toBe(0);
    expect(getPerfSnapshot().renderMs.avg).toBe(0);
    renderer = makeRenderer();
    fiber.state.gl = renderer;
    act(() => root.render(<RenderStatsProbe />));
    renderPass(7, 120); act(() => fiber.frame());
    expect(getPerfSnapshot().render.calls).toBe(7);
    expect(getPerfSnapshot().render.triangles).toBe(120);
  });
});
