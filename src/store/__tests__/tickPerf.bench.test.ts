import { describe, it, expect, afterAll } from 'vitest';
import { useEditorStore } from '../editorStore';
import { getPerfSnapshot } from '../../runtime/perfStats';

/**
 * Headless tick performance benchmark. The deep perf audit found steady-state Play is bound by React
 * re-render churn, NOT the tick — but that was one live measurement on one scene. This gives a
 * repeatable, rendering-free number for raw `tickRuntime` cost as the scripted-object count scales,
 * so optimizations can be proven (and regressions caught) without the live app. It is a measurement
 * tool first; the assertion is only a loose ceiling so CI fails if the tick blows up catastrophically.
 */
const STRESS_COUNT = 150; // scripted objects driven every frame
const WARMUP = 30;
const MEASURE = 600;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

describe('tickRuntime — performance benchmark', () => {
  afterAll(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it(`ticks a ${STRESS_COUNT}-scripted-object scene`, () => {
    // Build the stress scene from the starter Player Controller: every clone keeps the same script
    // graph (Update fires every frame), so all of them exercise the evaluator each tick.
    useEditorStore.getState().duplicateObject('obj-player', { count: STRESS_COUNT, offset: [2, 0, 0] });

    const store = useEditorStore.getState();
    store.setPlaying(true);
    store.setRuntimeKey('KeyW', true); // drive the input → movement path on every clone

    for (let i = 0; i < WARMUP; i += 1) useEditorStore.getState().tickRuntime(1 / 60);

    const frames: number[] = [];
    for (let i = 0; i < MEASURE; i += 1) {
      const t0 = performance.now();
      useEditorStore.getState().tickRuntime(1 / 60);
      frames.push(performance.now() - t0);
    }
    store.setRuntimeKey('KeyW', false);

    frames.sort((a, b) => a - b);
    const avg = frames.reduce((s, v) => s + v, 0) / frames.length;
    const snap = getPerfSnapshot();

    // Surfaced to the test output so before/after optimization is visible.
    // eslint-disable-next-line no-console
    console.log(
      `[tick-bench] objects=${STRESS_COUNT} ticks=${MEASURE} | ` +
        `avg=${avg.toFixed(3)}ms p50=${percentile(frames, 0.5).toFixed(3)} ` +
        `p95=${percentile(frames, 0.95).toFixed(3)} max=${frames[frames.length - 1].toFixed(3)} | ` +
        `scripts-section avg=${snap.sections.scripts.avg.toFixed(3)}ms`,
    );

    expect(avg).toBeLessThan(16); // a full 60fps frame budget for the tick alone — generous ceiling
  });
});
