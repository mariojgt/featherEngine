import { describe, it, expect, vi, afterEach } from 'vitest';

// Force EVERY executed blueprint node to throw: markExec is the first call inside the runtime's
// per-node executor's try block, so a throwing markExec simulates any node blowing up during a tick.
// This proves the per-NODE error guard in tickRuntime: one bad node must not kill the whole frame loop,
// it must be recorded against that node (runtimeNodeErrors, for the editor badge) and reported once.
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

  it('catches a throwing node, keeps Play alive, records it on the node, and reports it once', () => {
    const store = useEditorStore.getState();
    store.setPlaying(true);

    // The default Player Controller has an Update event that fires every frame, so its node chain
    // runs (and now throws). The tick must absorb that, not propagate it.
    expect(() => useEditorStore.getState().tickRuntime(1 / 60)).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);

    // The failing node id(s) are recorded so the editor can badge them.
    const nodeErrors = useEditorStore.getState().runtimeNodeErrors;
    expect(Object.keys(nodeErrors).length).toBeGreaterThan(0);

    const log = useEditorStore.getState().runtimeLog;
    const errorLines = log.filter((line) => line.includes('error'));
    expect(errorLines.length).toBeGreaterThan(0);

    // Dedup: ticking many more frames must NOT keep appending the same error 60×/s, and the recorded
    // node-error set must stay stable (identity-stable snapshot — no churn).
    const before = errorLines.length;
    const errorsRef = useEditorStore.getState().runtimeNodeErrors;
    for (let frame = 0; frame < 60; frame += 1) {
      useEditorStore.getState().tickRuntime(1 / 60);
    }
    const after = useEditorStore.getState().runtimeLog.filter((line) => line.includes('error')).length;
    expect(after).toBe(before);
    // No new errors → the snapshot object identity is unchanged (drives the 60fps no-rerender guarantee).
    expect(useEditorStore.getState().runtimeNodeErrors).toBe(errorsRef);
  });
});
