import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera, MeshBasicMaterial, Scene, type WebGLRenderer } from 'three';
import { prewarmPrograms } from '../prewarmPrograms';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const material = new MeshBasicMaterial();
  const isReady = vi.fn().mockReturnValue(false);
  const properties = { currentProgram: { isReady } };
  const get = vi.fn(() => properties);
  const renderer = { compile: () => new Set([material]), properties: { get } } as unknown as WebGLRenderer;
  const done = vi.fn();
  const cancel = prewarmPrograms(renderer, new Scene(), new Camera(), done);
  return { material, isReady, properties, get, done, cancel };
}
describe('cancellable shader prewarm', () => {
  it('waits for compilation, then stops polling', () => {
    const f = fixture(); vi.advanceTimersByTime(30);
    expect(f.done).not.toHaveBeenCalled();
    f.isReady.mockReturnValue(true); vi.advanceTimersByTime(20);
    expect(f.done).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('drops materials disposed by fracture/replay without looking up a missing program', () => {
    const f = fixture(); vi.advanceTimersByTime(10); f.get.mockClear();
    f.material.dispose(); vi.advanceTimersByTime(20);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.done).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels on Stop or quality change without completing an abandoned warmup', () => {
    const f = fixture(); f.cancel(); f.material.dispose(); vi.advanceTimersByTime(100);
    expect(f.get).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('falls back to lazy rendering if Three has no program record yet', () => {
    const f = fixture(); f.get.mockReturnValue({} as typeof f.properties); vi.advanceTimersByTime(20);
    expect(f.done).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
