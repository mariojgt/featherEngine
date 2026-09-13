import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';
import { subscribeMeasuredFrames, type MeasuredFrame } from '../runtime/perfStats';
import { patchMatches, performanceSuggestions, summarizeFrames, type PerformanceMeasurement } from '../performance/assistant';
import type { RenderSettings } from '../types';

interface Preview { before: Partial<RenderSettings>; after: Partial<RenderSettings>; title: string; key: string }
interface AssistantState {
  open: boolean; recording: boolean; remaining: number; targetFps: 30 | 60 | 120;
  report: PerformanceMeasurement | null; previous: PerformanceMeasurement | null; preview: Preview | null; error: string | null;
  show: () => void; close: () => void; measure: (target?: 30 | 60 | 120) => void; cancel: () => void;
  previewFix: (id: string) => void; keepFix: () => void; restoreFix: () => void;
}
const projectKey = () => `${useProjectStore.getState().projectDir}|${useProjectStore.getState().projectName}`;
let stopCapture: (() => void) | null = null;
export const usePerformanceAssistantStore = create<AssistantState>((set, get) => ({
  open: false, recording: false, remaining: 12, targetFps: 60, report: null, previous: null, preview: null, error: null,
  show: () => set({ open: true }),
  close: () => { if (get().preview) get().restoreFix(); if (!get().preview) set({ open: false }); },
  cancel: () => { stopCapture?.(); },
  measure: (target = get().targetFps) => {
    const editor = useEditorStore.getState();
    if (get().recording) return;
    if (!useProjectStore.getState().hasProject || editor.isPlaying) { set({ error: 'Stop Play and open a project before measuring.' }); return; }
    const scene = editor.scenes.find(s => s.id === editor.activeSceneId);
    if (!scene) return;
    const key = projectKey(), settings = structuredClone(editor.renderSettings);
    const usedAssets = new Set(scene.objects.map(object => object.renderer?.modelAssetId).filter(Boolean));
    const assets = editor.assets.filter(asset => usedAssets.has(asset.id) && asset.modelInspection?.stats).map(asset => ({ id: asset.id, name: asset.name, triangles: asset.modelInspection!.stats!.triangles, textures: asset.modelInspection!.stats!.textures, sourceBytes: asset.modelInspection!.stats!.sourceBytes })).sort((a, b) => b.sourceBytes - a.sourceBytes).slice(0, 5);
    const frames: MeasuredFrame[] = [];
    let finished = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => {};
    const started = performance.now();
    const finish = (error?: string) => {
      if (finished) return;
      finished = true; clearInterval(timer); unsubscribe(); stopCapture = null;
      set({ recording: false, open: true, error: error ?? null });
      if (projectKey() === key && useEditorStore.getState().isPlaying) useEditorStore.getState().setPlaying(false);
      if (error) return;
      try {
        const summary = summarizeFrames(frames, target);
        const report: PerformanceMeasurement = { ...summary, assets, id: crypto.randomUUID(), sceneId: scene.id, sceneName: scene.name, createdAt: Date.now(), settings, targetFps: target, durationMs: performance.now() - started - 2000 };
        set({ previous: get().report?.sceneId === scene.id && get().report?.targetFps === target ? get().report : null, report });
      } catch (err) { set({ error: String(err) }); }
    };
    editor.setPlaying(true);
    if (!useEditorStore.getState().isPlaying) { set({ error: 'The scene could not start. Close prefab editing and check collaboration access.' }); return; }
    set({ open: false, recording: true, remaining: 12, targetFps: target, error: null });
    unsubscribe = subscribeMeasuredFrames(frame => { if (performance.now() - started >= 2000 && frames.length < 18000) frames.push(frame); });
    stopCapture = () => finish('Measurement cancelled.');
    timer = setInterval(() => {
      const current = useEditorStore.getState();
      if (projectKey() !== key || current.activeSceneId !== scene.id || !current.isPlaying || current.isPlayPaused || document.hidden) { finish('Measurement interrupted. Keep this scene playing in a visible tab for the full check.'); return; }
      if (JSON.stringify(current.renderSettings) !== JSON.stringify(settings)) { finish('Render settings changed during the check. Try again with consistent settings.'); return; }
      const elapsed = performance.now() - started;
      set({ remaining: Math.max(0, Math.ceil((12000 - elapsed) / 1000)) });
      if (elapsed >= 12000) finish();
    }, 100);
  },
  previewFix: id => {
    const { report, preview } = get(), editor = useEditorStore.getState();
    if (!report || preview || editor.isPlaying || report.sceneId !== editor.activeSceneId) { set({ error: 'Stop Play and restore or keep the current preview first.' }); return; }
    const suggestion = performanceSuggestions(report).find(s => s.id === id);
    if (!suggestion?.patch) return;
    const before: Partial<RenderSettings> = {};
    for (const key of Object.keys(suggestion.patch) as (keyof RenderSettings)[]) {
      if (editor.renderSettings[key] !== report.settings[key]) { set({ error: 'These settings changed since measurement. Measure again before applying this suggestion.' }); return; }
      Object.assign(before, { [key]: editor.renderSettings[key] ?? (key === 'quality' ? 'High' : undefined) });
    }
    editor.updateRenderSettings(suggestion.patch);
    set({ preview: { before, after: suggestion.patch, title: suggestion.title, key: projectKey() }, error: null });
  },
  keepFix: () => { if (!get().recording && !useEditorStore.getState().isPlaying) set({ preview: null }); },
  restoreFix: () => {
    const preview = get().preview;
    if (!preview) return;
    if (get().recording || useEditorStore.getState().isPlaying) { set({ error: 'Stop Play before restoring the preview.' }); return; }
    if (preview.key !== projectKey()) { set({ preview: null }); return; }
    const editor = useEditorStore.getState();
    if (!patchMatches(editor.renderSettings, preview.after)) { set({ error: 'The preview settings were edited elsewhere. Keep the current settings to dismiss this preview without overwriting them.' }); return; }
    editor.updateRenderSettings(preview.before); set({ preview: null, error: null });
  },
}));
// Never carry another project's measurements or reversible changes into the next project.
useProjectStore.subscribe((state, previous) => {
  if (state.projectDir !== previous.projectDir || state.projectName !== previous.projectName || state.hasProject !== previous.hasProject) {
    stopCapture?.(); usePerformanceAssistantStore.setState({ open: false, report: null, previous: null, preview: null, error: null });
  }
});
