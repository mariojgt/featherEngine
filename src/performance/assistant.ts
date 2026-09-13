import type { MeasuredFrame } from '../runtime/perfStats';
import type { RenderSettings } from '../types';

export interface PerformanceMeasurement {
  id: string; sceneId: string; sceneName: string; createdAt: number; targetFps: number;
  assets?: Array<{ id: string; name: string; triangles: number; textures: number; sourceBytes: number }>;
  settings: RenderSettings; samples: number; durationMs: number;
  averageMs: number; p95Ms: number; tickMs: number; renderMs: number; missedPercent: number; stalls: number;
  peakDrawCalls: number; peakTriangles: number; peakTextures: number; peakShadowLights: number;
}
export interface PerformanceSuggestion { id: string; title: string; reason: string; tradeoff: string; patch?: Partial<RenderSettings> }
export function summarizeFrames(frames: MeasuredFrame[], targetFps: number) {
  if (frames.length < 20) throw new Error('Too few frames were recorded. Keep the game visible and try again.');
  const ordered = frames.map(f => f.frameMs).sort((a, b) => a - b);
  const average = (pick: (f: MeasuredFrame) => number) => frames.reduce((sum, f) => sum + pick(f), 0) / frames.length;
  return {
    samples: frames.length, averageMs: average(f => f.frameMs), p95Ms: ordered[Math.ceil(ordered.length * .95) - 1],
    tickMs: average(f => f.tickMs), renderMs: average(f => f.renderMs),
    // Small tolerance avoids classifying normal 16.67ms vsync jitter as a missed 60fps budget.
    missedPercent: 100 * frames.filter(f => f.frameMs > 1000 / targetFps * 1.1).length / frames.length,
    stalls: frames.filter(f => f.frameMs > 100).length,
    peakDrawCalls: Math.max(...frames.map(f => f.render.calls)), peakTriangles: Math.max(...frames.map(f => f.render.triangles)),
    peakTextures: Math.max(...frames.map(f => f.render.textures)), peakShadowLights: Math.max(...frames.map(f => f.render.shadowLights)),
  };
}
export function performanceSuggestions(report: PerformanceMeasurement): PerformanceSuggestion[] {
  const out: PerformanceSuggestion[] = [];
  if (report.missedPercent < 5) return out;
  if (report.tickMs > 1000 / report.targetFps * .4) out.push({ id: 'simulation', title: 'Inspect gameplay and physics', reason: `Simulation averaged ${report.tickMs.toFixed(1)} ms per frame.`, tradeoff: 'Open the F8 profiler to inspect scripts, physics and animation. Visual settings alone may not fix this cost.' });
  const quality = report.settings.quality ?? 'High';
  const levels = ['Low', 'Medium', 'High', 'Epic'] as const;
  const lower = levels[levels.indexOf(quality) - 1];
  if (lower) out.push({ id: 'quality', title: `Try ${lower} quality`, reason: `${report.missedPercent.toFixed(0)}% of recorded frames exceeded the ${report.targetFps} fps budget. Peak shadow lights: ${report.peakShadowLights}.`, tradeoff: 'Reduces render resolution, shadow detail and effects. Remeasure the same route to check the result.', patch: { quality: lower } });
  if (report.settings.bloomEnabled) out.push({ id: 'bloom', title: 'Try disabling bloom', reason: 'Bloom is enabled and adds post-processing work.', tradeoff: 'Bright materials lose their surrounding glow. This is a candidate to measure, not a proven bottleneck.', patch: { bloomEnabled: false } });
  if (report.peakDrawCalls > 300 || report.peakTriangles > 1_000_000) out.push({ id: 'geometry', title: 'Review repeated props and model detail', reason: `Recorded peaks: ${report.peakDrawCalls.toLocaleString()} draw calls and ${report.peakTriangles.toLocaleString()} triangles.`, tradeoff: 'Use static model instances and prepared mesh detail in build settings. Check complex models in Assets; changing original geometry is not automatic.' });
  if (report.assets?.some(asset => asset.sourceBytes > 8 * 1024 * 1024 || asset.textures > 8)) out.push({ id: 'assets', title: 'Review large model assets', reason: 'Some models in this scene have large source files or many textures. See the asset list below.', tradeoff: 'Review texture preparation in your build profile and compare the cooked build. Source file size is not GPU memory usage; original assets are preserved.' });
  if (!out.length) out.push({ id: 'inspect', title: 'Inspect the F8 profiler', reason: 'Frame pacing missed the target at the current settings.', tradeoff: 'Compare scripts, physics, rendering and browser stalls. These measurements do not identify GPU time.' });
  return out;
}
export function patchMatches(settings: RenderSettings, patch: Partial<RenderSettings>) {
  return Object.entries(patch).every(([key, value]) => settings[key as keyof RenderSettings] === value);
}
