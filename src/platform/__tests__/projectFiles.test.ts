import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  invoke: vi.fn(),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  watch: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn(), invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ join: mocks.join }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mocks.exists,
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  readTextFile: mocks.readTextFile,
  watch: mocks.watch,
  writeFile: vi.fn(),
  writeTextFile: mocks.writeTextFile,
}));

import { tauriPlatform } from '../tauri';
import { blankProject, splitProject } from '../../project/serialize';

describe('desktop snapshot integration', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const snapshot = (name: string, revision: string, recoveredFrom: string | null = null) => {
    const project = blankProject(name);
    const { manifest } = splitProject(project);
    return { manifest, scenes: project.scenes, revision, recoveredFrom };
  };

  it('saves every scene through one native command guarded by the opened revision', async () => {
    const opened = snapshot('Atomic', 'opened-revision');
    mocks.invoke.mockResolvedValueOnce(opened);
    await tauriPlatform.openProjectAt('/projects/atomic');
    mocks.invoke.mockResolvedValueOnce({ revision: 'saved-revision', warnings: [] });
    await tauriPlatform.saveProject('/projects/atomic', blankProject('Atomic'));
    expect(mocks.invoke).toHaveBeenLastCalledWith('save_project_snapshot', {
      projectDir: '/projects/atomic', manifestJson: expect.any(String),
      sceneJsons: [expect.any(String)], expectedRevision: 'opened-revision',
    });
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it('retains the disk checkpoint after failed saves so retries remain protected', async () => {
    mocks.invoke.mockResolvedValueOnce(snapshot('Retry', 'original-revision'));
    await tauriPlatform.openProjectAt('/projects/retry');
    mocks.invoke.mockRejectedValueOnce(new Error('Disk full'));
    await expect(tauriPlatform.saveProject('/projects/retry', blankProject('Retry'))).rejects.toThrow('Disk full');
    mocks.invoke.mockResolvedValueOnce({ revision: 'next-revision', warnings: [] });
    await tauriPlatform.saveProject('/projects/retry', blankProject('Retry'));
    expect(mocks.invoke.mock.calls.at(-1)?.[1].expectedRevision).toBe('original-revision');
  });

  it('exposes recovered saves and asks native code for earlier snapshots without writing', async () => {
    mocks.invoke.mockResolvedValueOnce(snapshot('Recovered', 'damaged-current', '.feather/backups/backup.json'));
    const opened = await tauriPlatform.openPreviousSave?.('/projects/recovered');
    expect(opened?.recoveredFrom).toBe('.feather/backups/backup.json');
    expect(mocks.invoke).toHaveBeenCalledWith('read_project_snapshot', { projectDir: '/projects/recovered', previous: true });
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it('rejects future formats before recording a save checkpoint', async () => {
    const future = snapshot('Future', 'future-revision'); future.manifest.version = '99.0.0';
    mocks.invoke.mockResolvedValueOnce(future);
    await expect(tauriPlatform.openProjectAt('/projects/future')).rejects.toThrow('Update Feather');
  });

  it('does not replace the save checkpoint when an earlier-save read finds an external change', async () => {
    mocks.invoke.mockResolvedValueOnce(snapshot('Original', 'original-checkpoint'));
    await tauriPlatform.openProjectAt('/projects/external-change');
    mocks.invoke.mockResolvedValueOnce(snapshot('Earlier', 'external-checkpoint', '.feather/backups/backup.json'));
    await expect(tauriPlatform.openPreviousSave?.('/projects/external-change')).rejects.toThrow('changed on disk');
    mocks.invoke.mockResolvedValueOnce({ revision: 'saved', warnings: [] });
    await tauriPlatform.saveProject('/projects/external-change', blankProject('Original'));
    expect(mocks.invoke.mock.calls.at(-1)?.[1].expectedRevision).toBe('original-checkpoint');
  });
});

describe('desktop project text files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lstat.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 128 });
  });

  it('reads and writes UTF-8 files below the project directory', async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.invoke.mockResolvedValueOnce('on start:\n    print("hello")');

    await expect(tauriPlatform.readProjectText?.('/projects/game', 'scripts/Player.feather')).resolves.toContain(
      'print',
    );
    expect(mocks.invoke).toHaveBeenCalledWith('read_project_text', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
    });

    await tauriPlatform.writeProjectText?.('/projects/game', 'scripts/Player.feather', 'blueprint Player');
    expect(mocks.invoke).toHaveBeenCalledWith('write_project_text_atomic', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
      contents: 'blueprint Player',
      checkExpected: false,
      expectedContents: null,
    });
  });

  it('passes an exact compare-and-swap guard to native linked-file writes', async () => {
    mocks.invoke.mockResolvedValueOnce({ kind: 'written' });

    await expect(
      tauriPlatform.writeProjectText?.(
        '/projects/game',
        'scripts/Player.feather',
        'blueprint Player\n\non start:\n    pass',
        { expectedContents: 'blueprint Player' },
      ),
    ).resolves.toEqual({ kind: 'written' });
    expect(mocks.invoke).toHaveBeenCalledWith('write_project_text_atomic', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
      contents: 'blueprint Player\n\non start:\n    pass',
      checkExpected: true,
      expectedContents: 'blueprint Player',
    });
  });

  it('returns null for a missing linked file', async () => {
    mocks.exists.mockResolvedValue(false);
    mocks.invoke.mockResolvedValueOnce(null);

    await expect(tauriPlatform.readProjectText?.('/projects/game', 'scripts/Missing.feather')).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith('read_project_text', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Missing.feather',
    });
  });

  it.each([
    '../outside.feather',
    'scripts/../outside.feather',
    '/tmp/outside.feather',
    'C:\\tmp\\outside.feather',
    'scripts/Player.feather:stream',
    'scripts/CON.feather',
    'scripts/trailing. ',
  ])(
    'rejects unsafe project-relative path %s',
    async (relativePath) => {
      await expect(tauriPlatform.readProjectText?.('/projects/game', relativePath)).rejects.toThrow(
        'Unsafe project-relative path',
      );
      await expect(tauriPlatform.writeProjectText?.('/projects/game', relativePath, 'nope')).rejects.toThrow(
        'Unsafe project-relative path',
      );
      await expect(tauriPlatform.revealProjectFile?.('/projects/game', relativePath)).rejects.toThrow(
        'Unsafe project-relative path',
      );
    },
  );

  it('rejects a linked path with an existing symbolic-link component', async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.lstat.mockImplementation(async (path: string) => ({
      isFile: !path.endsWith('/scripts'),
      isDirectory: false,
      isSymlink: path.endsWith('/scripts'),
      size: 128,
    }));

    await expect(
      tauriPlatform.readProjectText?.('/projects/game', 'scripts/Player.feather'),
    ).rejects.toThrow('cannot contain a symbolic link');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('debounces watches and reports only normalized paths inside requested project roots', async () => {
    let emit: ((event: { paths: string[] }) => void) | undefined;
    const stop = vi.fn();
    mocks.watch.mockImplementation(
      async (
        _paths: string[],
        callback: (event: { paths: string[] }) => void,
      ) => {
        emit = callback;
        return stop;
      },
    );
    const onChange = vi.fn();

    const cleanup = await tauriPlatform.watchProjectPaths?.(
      '/projects/game',
      ['scripts', 'scripts/Player.feather'],
      onChange,
      { debounceMs: 175 },
    );

    expect(mocks.watch).toHaveBeenCalledWith(
      ['/projects/game/scripts', '/projects/game/scripts/Player.feather'],
      expect.any(Function),
      { delayMs: 175, recursive: false },
    );
    emit?.({
      paths: [
        '/projects/game/scripts/Player.feather',
        '/projects/game/scripts/NPC.feather',
        '/projects/other/Outside.feather',
      ],
    });
    expect(onChange).toHaveBeenCalledWith(['scripts/Player.feather', 'scripts/NPC.feather']);

    cleanup?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('matches Windows watcher events without case-sensitive path loss', async () => {
    let emit: ((event: { paths: string[] }) => void) | undefined;
    mocks.exists.mockResolvedValue(false);
    mocks.watch.mockImplementation(
      async (_paths: string[], callback: (event: { paths: string[] }) => void) => {
        emit = callback;
        return vi.fn();
      },
    );
    const onChange = vi.fn();

    await tauriPlatform.watchProjectPaths?.('C:/Game', ['scripts'], onChange);
    emit?.({ paths: ['c:/game/SCRIPTS/Player.feather'] });

    expect(onChange).toHaveBeenCalledWith(['SCRIPTS/Player.feather']);
  });
});
