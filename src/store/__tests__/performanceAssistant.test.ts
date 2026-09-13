import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import { usePerformanceAssistantStore as assistant } from '../performanceAssistantStore';
import { recordFrame, isPerformanceCaptureActive } from '../../runtime/perfStats';
import { summarizeFrames, type PerformanceMeasurement } from '../../performance/assistant';
const initial = useEditorStore.getState().exportProject();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  useEditorStore.getState().loadProject(structuredClone(initial));
  useProjectStore.setState({ hasProject: true, projectDir: 'test', projectName: 'Perf test' });
  assistant.setState({ report: null, previous: null, preview: null, error: null });
});
afterEach(() => { assistant.getState().cancel(); useEditorStore.getState().setPlaying(false); vi.useRealTimers(); });
it('captures after warmup, completes, restores Play and releases adaptive quality hold', () => {
  assistant.getState().measure(60); expect(isPerformanceCaptureActive()).toBe(true);
  recordFrame(45, 2); vi.advanceTimersByTime(2100);
  for (let i = 0; i < 60; i++) { recordFrame(20, 2); vi.advanceTimersByTime(20); }
  vi.advanceTimersByTime(9000);
  expect(assistant.getState().report).toMatchObject({ samples: 60, averageMs: 20, targetFps: 60 });
  expect(assistant.getState().error).toBeNull(); expect(useEditorStore.getState().isPlaying).toBe(false); expect(isPerformanceCaptureActive()).toBe(false);
});
it('cancels a paused or hidden capture without publishing partial results', () => {
  assistant.getState().measure(); useEditorStore.getState().setPlayPaused(true); vi.advanceTimersByTime(100);
  expect(assistant.getState().report).toBeNull(); expect(assistant.getState().error).toContain('interrupted'); expect(isPerformanceCaptureActive()).toBe(false);
  assistant.getState().measure(); Object.defineProperty(document, 'hidden', { configurable: true, value: true }); vi.advanceTimersByTime(100);
  expect(assistant.getState().recording).toBe(false);
});
it('previews and restores quality without clobbering an intervening manual edit', () => {
  const editor = useEditorStore.getState(); editor.updateRenderSettings({ quality: 'High' });
  const render = { calls: 1, triangles: 1, programs: 1, geometries: 1, textures: 1, lights: 1, shadowLights: 1, shadowCasters: 1, skinned: 0 };
  const report: PerformanceMeasurement = { ...summarizeFrames(Array.from({ length: 30 }, () => ({ frameMs: 40, tickMs: 1, renderMs: 1, render })), 60), id: 'r', sceneId: editor.activeSceneId, sceneName: 'Test', createdAt: 0, durationMs: 10000, targetFps: 60, settings: structuredClone(useEditorStore.getState().renderSettings) };
  assistant.setState({ report }); assistant.getState().previewFix('quality'); expect(useEditorStore.getState().renderSettings.quality).toBe('Medium');
  assistant.getState().restoreFix(); expect(useEditorStore.getState().renderSettings.quality).toBe('High');
  assistant.getState().previewFix('quality'); editor.updateRenderSettings({ quality: 'Low' }); assistant.getState().restoreFix();
  expect(useEditorStore.getState().renderSettings.quality).toBe('Low'); expect(assistant.getState().error).toContain('edited elsewhere');
  assistant.getState().keepFix(); expect(assistant.getState().preview).toBeNull();
});
