import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../../project/serialize';
import type { NodeForgeProject } from '../../types';

const mocks = vi.hoisted(() => ({
  save: vi.fn(), create: vi.fn(), open: vi.fn(), clearRecovery: vi.fn(),
}));
vi.mock('../../platform', () => ({
  isDesktop: true,
  getPlatform: async () => ({ isDesktop: true, saveProject: mocks.save, createProject: mocks.create, openPreviousSave: mocks.open }),
}));
vi.mock('../autosave', () => ({ clearRecovery: mocks.clearRecovery }));
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('saving authored project state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Original'));
    useEditorStore.setState({ isDirty: true });
    useProjectStore.setState({ hasProject: true, projectDir: '/projects/Original', projectName: 'Original', busy: false, error: null, toast: null });
    mocks.save.mockResolvedValue(undefined);
    mocks.create.mockImplementation(async (name: string, project: NodeForgeProject) => ({ dir: `/projects/${name}`, name, project }));
  });

  it('marks the exact saved state clean when no newer edits exist', async () => {
    await useProjectStore.getState().save();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('keeps edits made during a save dirty and saves one consistent earlier snapshot', async () => {
    const disk = deferred<void>(); mocks.save.mockReturnValue(disk.promise);
    const saving = useProjectStore.getState().save();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const sent = mocks.save.mock.calls[0][1] as NodeForgeProject;
    useEditorStore.getState().createObjectWithProps('cube', { name: 'Newer edit' });
    disk.resolve(); await saving;
    expect(sent.scenes[0].objects).toHaveLength(0);
    expect(useEditorStore.getState().scenes[0].objects.some((object) => object.name === 'Newer edit')).toBe(true);
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().toast?.message).toContain('newer edits');
  });

  it('preserves dirty state and reports failed writes', async () => {
    mocks.save.mockRejectedValue(new Error('Disk full'));
    await useProjectStore.getState().save();
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().error).toBe('Disk full');
    expect(useProjectStore.getState().busy).toBe(false);
  });

  it('serializes saves and blocks project closure until the save finishes', async () => {
    const disk = deferred<void>(); mocks.save.mockReturnValue(disk.promise);
    const saving = useProjectStore.getState().save();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await useProjectStore.getState().save();
    await useProjectStore.getState().exportGame();
    await useProjectStore.getState().exportProjectPackage();
    await useProjectStore.getState().importPackageFromFile();
    expect(await useProjectStore.getState().importPackageFromUrl('/package.nfpack')).toBe(false);
    expect(useProjectStore.getState().busy).toBe(true);
    useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().hasProject).toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    disk.resolve(); await saving;
  });

  it('refuses to save runtime preview changes', async () => {
    useEditorStore.getState().setPlaying(true);
    await useProjectStore.getState().save();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(useProjectStore.getState().error).toContain('Stop Play');
  });

  it('makes Save as assets portable instead of referencing the old project folder', async () => {
    useEditorStore.getState().addAssetItems([{ id: 'image', name: 'test.png', type: 'image', size: 1,
      createdAt: 0, path: 'assets/old.png', data: 'data:image/png;base64,AA==' }]);
    await useProjectStore.getState().saveAs('Copy');
    const project = mocks.create.mock.calls[0][1] as NodeForgeProject;
    expect(project.assets[0].path).toBeUndefined();
    expect(project.assets[0].data).toBe('data:image/png;base64,AA==');
    expect(useEditorStore.getState().assets[0].url).toBe(project.assets[0].data);
    expect(useEditorStore.getState().assets[0].path).toBeUndefined();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('preserves edits and new imports made while Save as is awaiting its destination', async () => {
    const destination = deferred<{ dir: string; name: string; project: NodeForgeProject }>();
    mocks.create.mockReturnValue(destination.promise);
    const saving = useProjectStore.getState().saveAs('Copy');
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const project = mocks.create.mock.calls[0][1] as NodeForgeProject;
    useEditorStore.getState().createObjectWithProps('cube', { name: 'Keep this edit' });
    useEditorStore.getState().addAssetItems([{ id: 'new', name: 'new.png', type: 'image', size: 1,
      createdAt: 0, path: 'assets/old-folder.png', url: 'data:image/png;base64,AQ==' }]);
    destination.resolve({ dir: '/projects/Copy', name: 'Copy', project }); await saving;
    expect(project.scenes[0].objects).toHaveLength(0);
    expect(useEditorStore.getState().scenes[0].objects.some((object) => object.name === 'Keep this edit')).toBe(true);
    expect(useEditorStore.getState().assets[0].url).toBe('data:image/png;base64,AQ==');
    expect(useEditorStore.getState().assets[0].path).toBeUndefined();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('restores embedded asset URLs and retains recovery until explicit save or discard', () => {
    const project = blankProject('Recovered');
    project.assets = [{ id: 'image', name: 'test.png', type: 'image', size: 1, createdAt: 0, data: 'data:image/png;base64,AA==' }];
    useProjectStore.getState().restoreRecovery({ name: 'Recovered', dir: 'web', savedAt: Date.now(), project });
    expect(useEditorStore.getState().assets[0].url).toBe(project.assets[0].data);
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(mocks.clearRecovery).not.toHaveBeenCalled();
  });

  it('does not replace current edits when an earlier save is opened', async () => {
    await useProjectStore.getState().openPreviousSave();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(useProjectStore.getState().toast?.message).toContain('save your current edits');
  });

  it('does not replace edits made while reading an earlier save', async () => {
    useEditorStore.getState().markClean();
    const previous = deferred<{ dir: string; name: string; project: NodeForgeProject }>(); mocks.open.mockReturnValue(previous.promise);
    const loading = useProjectStore.getState().openPreviousSave();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    useEditorStore.getState().createObjectWithProps('cube', { name: 'Keep current edit' });
    previous.resolve({ dir: '/projects/Original', name: 'Older', project: blankProject('Older') }); await loading;
    expect(useEditorStore.getState().scenes[0].objects.some((object) => object.name === 'Keep current edit')).toBe(true);
    expect(useProjectStore.getState().error).toContain('changed while loading');
  });
});
