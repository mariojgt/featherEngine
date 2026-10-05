import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../../project/serialize';

const model = vi.hoisted(() => ({
  editor: {} as Record<string, any>,
  project: { hasProject: true, projectName: 'Original', projectDir: 'web' },
  subscriber: null as ((state: any, previous: any) => void) | null,
  read: vi.fn(), write: vi.fn(), clear: vi.fn(), embed: vi.fn(),
}));
vi.mock('../editorStore', () => ({ useEditorStore: {
  getState: () => model.editor,
  subscribe: (callback: typeof model.subscriber) => { model.subscriber = callback; return () => { model.subscriber = null; }; },
} }));
vi.mock('../projectStore', () => ({ useProjectStore: { getState: () => model.project } }));
vi.mock('../recoveryStorage', () => ({ readStoredRecovery: model.read, writeStoredRecovery: model.write, clearStoredRecovery: model.clear }));
vi.mock('../../project/exportGame', () => ({ embedAssets: model.embed }));
vi.mock('../../collaboration/access', () => ({ canUseHostOnlyFeatures: () => true }));

let autosave: typeof import('../autosave');
let windowEvents: ReturnType<typeof vi.spyOn>;
let documentEvents: ReturnType<typeof vi.spyOn>;
function publish(patch: Record<string, unknown>) {
  const previous = model.editor;
  model.editor = { ...previous, ...patch };
  model.subscriber?.(model.editor, previous);
}
function edit(name: string) { publish({ isDirty: true, scenes: [{ ...model.editor.scenes[0], name }] }); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('autosave under real editing timing', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    model.read.mockReset().mockResolvedValue(undefined);
    model.write.mockReset().mockResolvedValue('current');
    model.clear.mockReset().mockResolvedValue(undefined);
    model.embed.mockReset().mockImplementation(async (assets) => assets);
    model.project = { hasProject: true, projectName: 'Original', projectDir: 'web' };
    const initial = blankProject('Original');
    model.editor = { ...initial, isDirty: false, isPlaying: false, exportProject: () => ({
      ...initial, scenes: model.editor.scenes, assets: model.editor.assets,
    }) };
    windowEvents = vi.spyOn(window, 'addEventListener'); documentEvents = vi.spyOn(document, 'addEventListener');
    autosave = await import('../autosave'); autosave.initAutosave();
  });
  afterEach(async () => {
    autosave.clearRecovery();
    await Promise.resolve();
    for (const [event, listener] of windowEvents.mock.calls) if (event === 'pagehide') window.removeEventListener(event, listener as EventListener);
    for (const [event, listener] of documentEvents.mock.calls) if (event === 'visibilitychange') document.removeEventListener(event, listener as EventListener);
    vi.useRealTimers(); vi.restoreAllMocks();
  });

  it('stores snapshots larger than the former localStorage limit with asset bytes intact', async () => {
    const data = `data:image/png;base64,${'A'.repeat(4_100_000)}`;
    publish({ assets: [{ id: 'image', type: 'image', name: 'large.png', data, size: 3_000_000, createdAt: 0 }], isDirty: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(model.write).toHaveBeenCalledTimes(1);
    expect(model.write.mock.calls[0][0].project.assets[0].data).toBe(data);
    expect(autosave.getRecoveryStatus().state).toBe('saved');
  });

  it('writes within thirty seconds even while edits arrive every second', async () => {
    edit('First');
    for (let second = 1; second <= 30; second += 1) {
      await vi.advanceTimersByTimeAsync(1000); edit(`Edit ${second}`);
    }
    expect(model.write).toHaveBeenCalledTimes(1);
    expect(model.write.mock.calls[0][0].project.scenes[0].name).toBe('Edit 29');
  });

  it('ignores selection and runtime diagnostic updates while waiting for recovery', async () => {
    edit('Authored'); await vi.advanceTimersByTimeAsync(4000);
    const statusListener = vi.fn(); const stop = autosave.subscribeRecoveryStatus(statusListener);
    for (let i = 0; i < 200; i += 1) publish({ selectedObjectId: `selection-${i}`, runtimeKeys: { KeyW: true } });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(model.write).toHaveBeenCalledTimes(1); expect(statusListener).not.toHaveBeenCalled(); stop();
  });

  it('cancels pending recovery during Play and resumes with authored state after Stop', async () => {
    edit('Authored'); publish({ isPlaying: true });
    await vi.advanceTimersByTimeAsync(35_000); expect(model.write).not.toHaveBeenCalled();
    publish({ isPlaying: false }); await vi.advanceTimersByTimeAsync(4000);
    expect(model.write.mock.calls[0][0].project.scenes[0].name).toBe('Authored');
  });

  it('cannot resurrect discarded work when asset embedding finishes late', async () => {
    const pending = deferred(); model.embed.mockImplementation(async () => { await pending.promise; return []; });
    edit('Discard me'); await vi.advanceTimersByTimeAsync(4000);
    autosave.clearRecovery(); pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(model.write).not.toHaveBeenCalled(); expect(autosave.getRecoveryStatus().state).toBe('idle');
  });

  it('does not issue a stale delete after a cleared in-flight write and a new project edit', async () => {
    const pending = deferred(); model.write.mockImplementationOnce(() => pending.promise);
    edit('Old project'); await vi.advanceTimersByTimeAsync(4000);
    autosave.clearRecovery(); model.project = { ...model.project, projectName: 'New project' }; edit('New scene');
    await vi.advanceTimersByTimeAsync(4000); pending.resolve(); await vi.advanceTimersByTimeAsync(4000);
    expect(model.clear).toHaveBeenCalledTimes(1);
    expect(model.write).toHaveBeenCalledTimes(2);
    expect(model.write.mock.calls[1][0].name).toBe('New project');
  });

  it('retains the last successful snapshot and timestamp when assets or storage fail', async () => {
    edit('Successful'); await vi.advanceTimersByTimeAsync(4000);
    const saved = model.write.mock.calls[0][0]; model.read.mockResolvedValue(saved);
    model.embed.mockResolvedValue([{ id: 'missing', name: 'missing.glb', unresolved: true }]);
    publish({ isDirty: true, assets: [{ id: 'missing', name: 'missing.glb', url: 'blob:expired' }] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(model.write).toHaveBeenCalledTimes(1);
    expect(autosave.getRecoveryStatus()).toMatchObject({ state: 'unavailable', lastSuccess: saved.savedAt });
    await expect(autosave.readRecovery()).resolves.toEqual(saved);
  });

  it('flushes authored edits best-effort when the page is hidden', async () => {
    edit('Before leaving'); window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(model.write).toHaveBeenCalledTimes(1);
    expect(model.write.mock.calls[0][0].project.scenes[0].name).toBe('Before leaving');
  });
});
