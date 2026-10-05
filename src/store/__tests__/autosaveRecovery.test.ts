import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../../project/serialize';

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), clear: vi.fn() }));
vi.mock('../recoveryStorage', () => ({
  readStoredRecovery: storage.read,
  writeStoredRecovery: storage.write,
  clearStoredRecovery: storage.clear,
}));
vi.mock('../../collaboration/access', () => ({ canUseHostOnlyFeatures: () => true }));
vi.mock('../../project/exportGame', () => ({ embedAssets: vi.fn(async (assets) => assets) }));
vi.mock('../editorStore', () => ({ useEditorStore: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../projectStore', () => ({ useProjectStore: { getState: vi.fn() } }));

import { clearRecovery, getRecoveryStatus, readRecovery } from '../autosave';

const snapshot = () => ({
  name: 'Recovered',
  dir: null,
  savedAt: 123,
  project: blankProject('Recovered'),
});

describe('recovery snapshots', () => {
  beforeEach(() => {
    storage.read.mockReset();
    storage.write.mockReset().mockResolvedValue('current');
    storage.clear.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  it('reads valid snapshots from async durable storage', async () => {
    const value = snapshot();
    storage.read.mockResolvedValue(value);
    await expect(readRecovery()).resolves.toEqual(value);
  });

  it('rejects malformed metadata and project structure', async () => {
    storage.read.mockResolvedValue({ ...snapshot(), savedAt: NaN });
    await expect(readRecovery()).resolves.toBeNull();
  });

  it('migrates a legacy localStorage snapshot only after the durable write succeeds', async () => {
    storage.read.mockResolvedValue(undefined);
    const value = JSON.parse(JSON.stringify(snapshot()));
    localStorage.setItem('nodeforge.recovery', JSON.stringify(value));
    await expect(readRecovery()).resolves.toEqual(value);
    expect(storage.write).toHaveBeenCalledWith(value);
    expect(localStorage.getItem('nodeforge.recovery')).toBeNull();
  });

  it('retains legacy recovery if migration storage is unavailable and exposes the reason', async () => {
    storage.read.mockResolvedValue(undefined);
    storage.write.mockRejectedValue(new Error('IndexedDB denied'));
    localStorage.setItem('nodeforge.recovery', JSON.stringify(snapshot()));
    await expect(readRecovery()).resolves.toEqual(JSON.parse(localStorage.getItem('nodeforge.recovery')!));
    expect(localStorage.getItem('nodeforge.recovery')).not.toBeNull();
    expect(getRecoveryStatus()).toMatchObject({ state: 'unavailable', reason: 'IndexedDB denied' });
  });

  it.each(['99.0.0', 'invalid'])('preserves durable format %s when an older legacy copy exists', async (version) => {
    const stored = snapshot(); stored.project.version = version;
    storage.read.mockResolvedValue(stored);
    const legacy = JSON.parse(JSON.stringify(snapshot()));
    localStorage.setItem('nodeforge.recovery', JSON.stringify(legacy));
    await expect(readRecovery()).resolves.toEqual(legacy);
    expect(storage.write).not.toHaveBeenCalled();
    expect(localStorage.getItem('nodeforge.recovery')).not.toBeNull();
    expect(stored.project.version).toBe(version);
    expect(getRecoveryStatus().state).toBe('unavailable');
  });

  it('invalidates and clears both durable and legacy recovery', () => {
    localStorage.setItem('nodeforge.recovery', JSON.stringify(snapshot()));
    clearRecovery();
    expect(storage.clear).toHaveBeenCalled();
    expect(localStorage.getItem('nodeforge.recovery')).toBeNull();
  });
});
