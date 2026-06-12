import { useEditorStore } from '../store/editorStore';
import type { QualityLevel } from '../types';

/**
 * Adaptive quality: while the game is playing, sustained low framerate steps the scalability preset
 * DOWN (Epic → High → Medium → Low) and recovered headroom steps it back UP — but never above the
 * user's own setting (their pick is the ceiling, we only ever degrade-and-restore). Driven by the
 * same drei PerformanceMonitor that already adapts DPR in the editor viewport and the player.
 *
 * Steps are spaced ≥5s apart: each quality change rebuilds the post-FX pipeline (a one-frame hitch),
 * so oscillating fast would be worse than the low framerate it fixes.
 */
const ORDER: QualityLevel[] = ['Low', 'Medium', 'High', 'Epic'];

/** The quality the USER had chosen before we ever stepped down — the ceiling, and what Stop restores. */
let baseline: QualityLevel | null = null;
let lastStepAt = 0;
let lastDownAt = 0;

export function autoQualityStep(direction: -1 | 1) {
  const state = useEditorStore.getState();
  const settings = state.renderSettings;
  if (settings.autoQuality === false || !state.isPlaying) return;
  const now = performance.now();
  if (now - lastStepAt < 5000) return;
  // Asymmetric hysteresis: recover quality only after the framerate has been healthy for a while.
  // Stepping back up 5s after a down-step oscillates (each step rebuilds the post-FX pipeline —
  // the rebuild hitch then triggers the next decline), so the way up is deliberately slower.
  if (direction === 1 && now - lastDownAt < 15000) return;
  const current = settings.quality ?? 'High';
  const index = ORDER.indexOf(current);
  if (index < 0) return;
  if (baseline === null) baseline = current;
  const ceiling = ORDER.indexOf(baseline);
  const next = Math.min(Math.max(index + direction, 0), ceiling < 0 ? ORDER.length - 1 : ceiling);
  if (next === index) return;
  lastStepAt = now;
  if (direction === -1) lastDownAt = now;
  // Direct setState (not updateRenderSettings): an automatic perf adaptation must not dirty the project.
  useEditorStore.setState({ renderSettings: { ...settings, quality: ORDER[next] } });
}

/** Put the user's authored quality back (called when Play stops in the editor). */
export function resetAutoQuality() {
  if (baseline !== null) {
    const state = useEditorStore.getState();
    if ((state.renderSettings.quality ?? 'High') !== baseline) {
      useEditorStore.setState({ renderSettings: { ...state.renderSettings, quality: baseline } });
    }
    baseline = null;
  }
  lastStepAt = 0;
  lastDownAt = 0;
}
