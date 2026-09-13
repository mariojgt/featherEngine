import { create } from 'zustand';
import { getPlatform } from '../platform';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';
import { activeExportProfile, validateExportProfile } from '../project/exportProfiles';
import { buildGameBundle, embedAssets } from '../project/exportGame';
import { verifyGameBundle } from '../project/verifyBundle';
import { cloudProjectKey, readCloudHistory, validateCloudSetup, type CloudSetup, type CloudReply, type CloudJob, type CloudRequest } from '../project/cloudBuild';
interface PreparedBuild { bundleJson: string; bytes: number; name: string; scenes: number; assets: number; warnings: string[]; createdAt: number; commit: string }
interface BuildCentreState {
  open: boolean; key: string; setup: CloudSetup; jobs: CloudJob[]; checked: CloudReply | null;
  prepared: PreparedBuild | null; busy: boolean; error: string | null; message: string | null;
  show: () => void; close: () => void; configure: (setup: CloudSetup) => void;
  check: () => Promise<void>; prepare: () => Promise<void>; start: () => Promise<void>;
  manage: (requestId: string, action: 'status' | 'download' | 'cancel' | 'retry' | 'cleanup') => Promise<void>;
}
const currentKey = () => cloudProjectKey(useProjectStore.getState().projectDir, useProjectStore.getState().projectName);
function persist(key: string, value: { setup: CloudSetup; jobs: CloudJob[] }) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Remote jobs remain accessible in GitHub Actions. */ } }
async function cloud(request: CloudRequest) { const platform = await getPlatform(); if (!platform.cloudBuild) throw new Error('Open Feather desktop to use GitHub builds. Local web builds work here.'); return platform.cloudBuild(request); }
export const useBuildCentreStore = create<BuildCentreState>((set, get) => {
  const save = () => persist(get().key, { setup: get().setup, jobs: get().jobs });
  const updateJob = (key: string, requestId: string, patch: Partial<CloudJob>) => {
    if (get().key === key) { set({ jobs: get().jobs.map(job => job.requestId === requestId ? { ...job, ...patch } : job) }); save(); }
    else { const state = readCloudHistory(key); persist(key, { ...state, jobs: state.jobs.map(job => job.requestId === requestId ? { ...job, ...patch } : job) }); }
  };
  const operation = async (task: (key: string) => Promise<void>) => {
    if (get().busy) return;
    const key = get().key; set({ busy: true, error: null, message: null });
    try { await task(key); } catch (error) { if (get().key === key) set({ error: String(error) }); }
    finally { if (get().key === key) set({ busy: false }); }
  };
  return {
    open: false, key: currentKey(), ...readCloudHistory(currentKey()), checked: null, prepared: null, busy: false, error: null, message: null,
    show: () => { const key = currentKey(); if (key !== get().key) set({ key, ...readCloudHistory(key), prepared: null, checked: null }); set({ open: true }); },
    close: () => set({ open: false }),
    configure: setup => { if (get().busy) return; set({ setup, checked: null, prepared: null, error: null }); save(); },
    check: () => operation(async key => {
      const setup = get().setup, error = validateCloudSetup(setup); if (error) throw new Error(error);
      set({ checked: null, prepared: null });
      const checked = await cloud({ ...setup, action: 'check' }); if (get().key === key) set({ checked });
    }),
    prepare: () => operation(async key => {
      const editor = useEditorStore.getState(), project = useProjectStore.getState(), commit = get().checked?.commit;
      if (!commit) throw new Error('Check the repository before preparing a cloud build.');
      if (!project.hasProject || editor.isPlaying) throw new Error('Stop Play and open a project before preparing a build.');
      const snapshot = { ...editor.exportProject(), name: project.projectName };
      const profile = { ...activeExportProfile(snapshot.exportSettings), targets: ['windows', 'macos', 'linux', 'web'] as const };
      const selected = { ...profile, targets: [...profile.targets] };
      const errors = validateExportProfile(selected, snapshot.scenes.map(scene => scene.id)); if (errors.length) throw new Error(errors.join('; '));
      snapshot.assets = await embedAssets(editor.assets);
      const bundle = buildGameBundle(snapshot, selected), report = verifyGameBundle(bundle);
      if (report.errors.length) throw new Error(report.errors.join('; '));
      const bundleJson = JSON.stringify(bundle), bytes = new TextEncoder().encode(bundleJson).byteLength;
      if (bytes > 512 * 1024 * 1024) throw new Error('This game package exceeds the 512 MB cloud upload limit.');
      if (get().key === key) set({ prepared: { bundleJson, bytes, name: selected.application.productName, scenes: snapshot.scenes.length, assets: snapshot.assets.length, warnings: report.warnings, createdAt: Date.now(), commit } });
    }),
    start: () => operation(async key => {
      const prepared = get().prepared, setup = get().setup;
      if (!prepared || get().checked?.commit !== prepared.commit) throw new Error('Prepare and review the game package first.');
      const requestId = crypto.randomUUID().replace(/-/g, '');
      const job: CloudJob = { ...setup, requestId, createdAt: Date.now(), commit: prepared.commit };
      set({ jobs: [job, ...get().jobs].slice(0, 20), prepared: null }); save();
      try {
        const reply = await cloud({ ...setup, requestId, action: 'start', bundleJson: prepared.bundleJson, expectedCommit: prepared.commit });
        if (get().key === key) set({ message: reply.message ?? 'Build requested.' });
      } catch (error) { updateJob(key, requestId, { error: String(error) }); throw error; }
    }),
    manage: (requestId, action) => operation(async key => {
      const job = get().jobs.find(job => job.requestId === requestId); if (!job) throw new Error('Build request not found.');
      const reply = await cloud({ repository: job.repository, ref: job.ref, requestId, runId: job.run?.id, action });
      updateJob(key, requestId, { ...(reply.run ? { run: reply.run, error: undefined } : {}), ...(reply.directory ? { directory: reply.directory } : {}), ...(action === 'cleanup' ? { cleaned: true } : {}) });
      if (get().key === key && reply.message) set({ message: reply.message });
    }),
  };
});
useProjectStore.subscribe((state, previous) => {
  if (state.projectDir !== previous.projectDir || state.projectName !== previous.projectName || state.hasProject !== previous.hasProject) {
    const key = currentKey(); useBuildCentreStore.setState({ open: false, key, ...readCloudHistory(key), checked: null, prepared: null, busy: false, error: null, message: null });
  }
});
