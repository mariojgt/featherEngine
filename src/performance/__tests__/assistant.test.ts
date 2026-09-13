import { describe, expect, it } from 'vitest';
import { summarizeFrames, performanceSuggestions, patchMatches, type PerformanceMeasurement } from '../assistant';
import { recordFrame, recordRender, subscribeMeasuredFrames, type MeasuredFrame } from '../../runtime/perfStats';
const render = { calls: 420, triangles: 1234567, programs: 3, geometries: 4, textures: 5, lights: 4, shadowLights: 2, shadowCasters: 40, skinned: 1 };
const frames = Array.from({ length: 100 }, (_, i) => ({ frameMs: i < 90 ? 16.67 : 40, tickMs: 2, renderMs: 3, render }));
const report = (): PerformanceMeasurement => ({ ...summarizeFrames(frames, 60), id: 'test', sceneId: 'scene', sceneName: 'Scene', createdAt: 0, targetFps: 60, durationMs: 10000, settings: { quality: 'High', bloomEnabled: true, bloomIntensity: 1, bloomThreshold: 1, bloomRadius: 1, vignetteEnabled: false } });
describe('guided performance evidence', () => {
  it('records each fresh frame once, excludes earlier samples and unsubscribes cleanly', () => {
    recordFrame(30, 2);
    const received: MeasuredFrame[] = [];
    const stop = subscribeMeasuredFrames(f => received.push(f));
    expect(() => subscribeMeasuredFrames(() => {})).toThrow('already running');
    recordRender(render); recordFrame(20, 3); recordFrame(Number.NaN, 2); stop(); recordFrame(40, 4);
    expect(received).toHaveLength(1); expect(received[0]).toMatchObject({ frameMs: 20, tickMs: 3, render });
  });
  it('counts pacing misses with tolerance and computes a percentile over the full recording', () => {
    expect(summarizeFrames(frames, 60)).toMatchObject({ samples: 100, p95Ms: 40, missedPercent: 10, peakDrawCalls: 420, peakTriangles: 1234567 });
    expect(() => summarizeFrames(frames.slice(0, 10), 60)).toThrow('Too few frames');
    expect(summarizeFrames(frames.slice(0, 90), 60).missedPercent).toBe(0);
  });
  it('suggests reversible visual trades only after measured budget misses', () => {
    expect(performanceSuggestions(report()).map(s => s.id)).toEqual(['quality', 'bloom', 'geometry']);
    expect(performanceSuggestions({ ...report(), missedPercent: 0 })).toEqual([]);
    const cpu = performanceSuggestions({ ...report(), tickMs: 12 }); expect(cpu[0].id).toBe('simulation');
  });
  it('restoration guards changed fields without blocking unrelated changes', () => {
    const settings = report().settings;
    expect(patchMatches({ ...settings, vignetteEnabled: true }, { quality: 'High' })).toBe(true);
    expect(patchMatches({ ...settings, quality: 'Low' }, { quality: 'High' })).toBe(false);
  });
});
