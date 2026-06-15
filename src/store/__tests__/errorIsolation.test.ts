import { describe, it, expect, vi, afterEach } from 'vitest';

// Force EVERY executed blueprint node to throw: markExec is the first call inside the runtime's
// per-node executor, so a throwing markExec simulates any node blowing up during a tick. This proves
// the per-object error guard in tickRuntime: one bad script must not kill the whole frame loop, and
// the failure must be reported (once) to the runtime console instead of vanishing or freezing Play.
vi.mock('../../runtime/execTrace', () => ({
  markExec: () => {
    throw new Error('simulated node failure');
  },
}));

import { useEditorStore } from '../editorStore';

describe('tickRuntime — per-object script error isolation', () => {
  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('catches a throwing node, keeps Play alive, and reports it once', () => {
    const store = useEditorStore.getState();
    store.setPlaying(true);

    // The default Player Controller has an Update event that fires every frame, so its node chain
    // runs (and now throws). The tick must absorb that, not propagate it.
    expect(() => useEditorStore.getState().tickRuntime(1 / 60)).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);

    const log = useEditorStore.getState().runtimeLog;
    const errorLines = log.filter((line) => line.includes('Script error'));
    expect(errorLines.length).toBeGreaterThan(0);

    // Dedup: ticking many more frames must NOT keep appending the same error 60×/s.
    const before = errorLines.length;
    for (let frame = 0; frame < 60; frame += 1) {
      useEditorStore.getState().tickRuntime(1 / 60);
    }
    const after = useEditorStore
      .getState()
      .runtimeLog.filter((line) => line.includes('Script error')).length;
    expect(after).toBe(before);
  });
});
