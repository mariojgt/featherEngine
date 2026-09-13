import { beforeEach, expect, it, vi } from 'vitest';
const { cloudBuild } = vi.hoisted(() => ({ cloudBuild: vi.fn() }));
vi.mock('../../platform', () => ({ isDesktop: true, getPlatform: async () => ({ isDesktop: true, cloudBuild }) }));
import { useBuildCentreStore as centre } from '../buildCentreStore';
import { useProjectStore } from '../projectStore';
import { useEditorStore } from '../editorStore';
import { blankProject } from '../../project/serialize';
import { readCloudHistory, validateCloudSetup } from '../../project/cloudBuild';
const setup = { repository: 'owner/engine', ref: 'main' };
const commit = 'a'.repeat(40);
beforeEach(() => {
  cloudBuild.mockReset(); localStorage.clear();
  useProjectStore.setState({ hasProject: true, projectDir: 'cloud-test', projectName: 'Cloud test' });
  useEditorStore.getState().loadProject(blankProject('Cloud test'));
  centre.setState({ ...centre.getState(), setup, checked: null, prepared: null, jobs: [], busy: false, error: null });
});
it('validates configuration and does not contact GitHub for an invalid repository', async () => {
  centre.getState().configure({ ...setup, repository: 'https://github.com/owner/engine' }); await centre.getState().check();
  expect(cloudBuild).not.toHaveBeenCalled(); expect(centre.getState().error).toContain('owner/name');
  expect(validateCloudSetup({ ...setup, ref: 'feature/builds' })).toBeNull();
  expect(validateCloudSetup({ ...setup, ref: 'main?x' })).not.toBeNull();
});
it('prepares a verified snapshot without uploading and dispatches those exact bytes after later edits', async () => {
  cloudBuild.mockResolvedValue({ repository: setup.repository, private: true, commit });
  await centre.getState().check(); await centre.getState().prepare();
  expect(centre.getState().error).toBeNull();
  const prepared = centre.getState().prepared!; expect(prepared).not.toBeNull();
  expect(cloudBuild.mock.calls.map(([request]) => request.action)).toEqual(['check']);
  useEditorStore.getState().updateRenderSettings({ bloomIntensity: 2.99 });
  cloudBuild.mockResolvedValue({ message: 'Requested' }); await centre.getState().start();
  const request = cloudBuild.mock.calls.at(-1)![0];
  expect(request).toMatchObject({ action: 'start', bundleJson: prepared.bundleJson, expectedCommit: commit, ...setup });
  expect(JSON.parse(request.bundleJson).project.renderSettings.bloomIntensity).not.toBe(2.99);
  expect(centre.getState().jobs).toHaveLength(1); expect(centre.getState().prepared).toBeNull();
  expect(readCloudHistory(centre.getState().key).jobs[0].requestId).toBe(request.requestId);
  expect(localStorage.getItem(centre.getState().key)).not.toContain('bundleJson');
});
it('keeps a failed request for recovery and never carries stale repository checks into another project', async () => {
  cloudBuild.mockResolvedValue({ commit }); await centre.getState().check(); await centre.getState().prepare();
  cloudBuild.mockRejectedValue(new Error('Upload interrupted')); await centre.getState().start();
  expect(centre.getState().jobs[0].error).toContain('Upload interrupted');
  let resolve!: (value: unknown) => void; cloudBuild.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = centre.getState().check(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  useProjectStore.setState({ projectDir: 'different-project' }); resolve({ commit }); await pending;
  expect(centre.getState().checked).toBeNull(); expect(centre.getState().jobs).toEqual([]);
});
it('invalidates review when the repository changes and refuses a launch without review', async () => {
  centre.setState({ checked: { commit } }); await centre.getState().prepare();
  centre.getState().configure({ ...setup, ref: 'release' }); expect(centre.getState().prepared).toBeNull();
  await centre.getState().start(); expect(cloudBuild).not.toHaveBeenCalled(); expect(centre.getState().error).toContain('review');
});
