import type { NodeForgeProject } from '../types';
import { canUseHostOnlyFeatures } from '../collaboration/access';
import { embedAssets } from '../project/exportGame';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';
import { clearStoredRecovery, readStoredRecovery, writeStoredRecovery } from './recoveryStorage';
import { assertProjectContainers, assertSupportedProjectVersion } from '../project/projectValidation';
import { authoredProjectChanged } from './editor/authoredState';

const LEGACY_RECOVERY_KEY = 'nodeforge.recovery';
const DEBOUNCE_MS = 4000;
const MAX_WAIT_MS = 30_000;

export type RecoverySnapshot = { name: string; dir: string | null; savedAt: number; project: NodeForgeProject };
export type RecoveryStatus = {
  state: 'idle' | 'pending' | 'saving' | 'saved' | 'unavailable';
  reason?: string;
  lastSuccess?: number;
};

let status: RecoveryStatus = { state: 'idle' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt: number | null = null;
let started = false;
let prevDirty = false;
let generation = 0;
let writing = false;
let writeAgain = false;
let editRevision = 0;
let embeddedSource: ReturnType<typeof useEditorStore.getState>['assets'] | null = null;
let embeddedAssets: NodeForgeProject['assets'] | null = null;

function setStatus(next: RecoveryStatus) {
  if (status.state === next.state && status.reason === next.reason && status.lastSuccess === next.lastSuccess) return;
  status = next;
  listeners.forEach((listener) => listener());
}
export const getRecoveryStatus = () => status;
export const subscribeRecoveryStatus = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

function failureReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Storage quota is full';
  return error instanceof Error && error.message ? error.message : 'Recovery storage failed';
}

function validProject(value: unknown): value is NodeForgeProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<NodeForgeProject>;
  try {
    assertSupportedProjectVersion(project);
    assertProjectContainers(project as Record<string, unknown>);
  } catch { return false; }
  return typeof project.name === 'string' && Array.isArray(project.scenes) && project.scenes.length > 0 &&
    typeof project.activeSceneId === 'string' && project.scenes.some((scene) => scene?.id === project.activeSceneId) &&
    Array.isArray(project.assets);
}
function validSnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return typeof snapshot.name === 'string' && snapshot.name.length > 0 &&
    (snapshot.dir === null || typeof snapshot.dir === 'string') && typeof snapshot.savedAt === 'number' &&
    Number.isFinite(snapshot.savedAt) && snapshot.savedAt > 0 && validProject(snapshot.project);
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
  firstPendingAt = null;
}
function scheduleWrite() {
  const now = Date.now();
  if (firstPendingAt === null) firstPendingAt = now;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void writeSnapshot(), Math.min(DEBOUNCE_MS, Math.max(0, MAX_WAIT_MS - (now - firstPendingAt))));
  setStatus({ state: 'pending', lastSuccess: status.lastSuccess });
}

async function writeSnapshot() {
  clearTimer();
  if (writing) { writeAgain = true; return; }
  const token = generation;
  const revision = editRevision;
  const capturedAt = Date.now();
  const editor = useEditorStore.getState();
  const projectState = useProjectStore.getState();
  if (!canUseHostOnlyFeatures() || !projectState.hasProject || !editor.isDirty || editor.isPlaying) return;
  writing = true;
  setStatus({ state: 'saving', lastSuccess: status.lastSuccess });
  try {
    const project = { ...editor.exportProject(), name: projectState.projectName };
    if (embeddedSource === editor.assets && embeddedAssets) project.assets = embeddedAssets;
    else {
      project.assets = (await embedAssets(editor.assets)).map(({ url: _url, ...asset }) => asset);
      const missing = project.assets.filter((asset) => asset.unresolved);
      if (missing.length) throw new Error(`Recovery could not copy these assets: ${missing.map((asset) => asset.name).join(', ')}. Re-import them and save your project.`);
      if (token === generation) { embeddedSource = editor.assets; embeddedAssets = project.assets; }
    }
    const snapshot: RecoverySnapshot = { name: projectState.projectName, dir: projectState.projectDir, savedAt: capturedAt, project };
    if (!validSnapshot(snapshot)) throw new Error('Recovery could not capture a valid project. Save your work to a project file.');
    if (token !== generation || useEditorStore.getState().isPlaying) return;
    await writeStoredRecovery(snapshot);
    // clearRecovery already queued a delete after this write. Never queue another stale delete.
    if (token !== generation) return;
    setStatus({ state: revision === editRevision ? 'saved' : 'pending', lastSuccess: snapshot.savedAt });
  } catch (error) {
    if (token === generation) setStatus({ state: 'unavailable', reason: failureReason(error), lastSuccess: status.lastSuccess });
  } finally {
    writing = false;
    if (writeAgain) { writeAgain = false; scheduleWrite(); }
  }
}

export function initAutosave() {
  if (started) return;
  started = true;
  prevDirty = useEditorStore.getState().isDirty;
  useEditorStore.subscribe((state, previous) => {
    if (state.isPlaying || !canUseHostOnlyFeatures()) { clearTimer(); prevDirty = state.isDirty; return; }
    if (prevDirty && !state.isDirty) clearRecovery();
    else if (state.isDirty && (!previous.isDirty || previous.isPlaying || authoredProjectChanged(previous, state))) {
      editRevision += 1;
      scheduleWrite();
    }
    prevDirty = state.isDirty;
  });
  const flush = () => {
    const editor = useEditorStore.getState();
    if (editor.isDirty && !editor.isPlaying) void writeSnapshot();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  if (prevDirty && !useEditorStore.getState().isPlaying) scheduleWrite();
}

export async function readRecovery(): Promise<RecoverySnapshot | null> {
  const token = generation;
  let legacy: unknown;
  try { const raw = localStorage.getItem(LEGACY_RECOVERY_KEY); legacy = raw ? JSON.parse(raw) : null; }
  catch { legacy = null; }
  try {
    const stored = await readStoredRecovery();
    if (token !== generation) return null;
    if (validSnapshot(stored)) return stored;
    if (stored != null) {
      // Preserve unknown/newer data. An old localStorage copy must not silently overwrite it.
      setStatus({ state: 'unavailable', reason: 'The recovery copy is damaged or requires a newer Feather version.', lastSuccess: status.lastSuccess });
      return validSnapshot(legacy) ? legacy : null;
    }
    if (!validSnapshot(legacy)) return null;
    await writeStoredRecovery(legacy);
    if (token !== generation) return null;
    try { localStorage.removeItem(LEGACY_RECOVERY_KEY); } catch { /* cleanup is optional */ }
    return legacy;
  } catch (error) {
    if (token !== generation) return null;
    setStatus({ state: 'unavailable', reason: failureReason(error), lastSuccess: status.lastSuccess });
    // Storage being unavailable must not make a valid existing legacy copy inaccessible.
    return validSnapshot(legacy) ? legacy : null;
  }
}

export function clearRecovery() {
  generation += 1;
  const token = generation;
  embeddedSource = null;
  embeddedAssets = null;
  writeAgain = false;
  clearTimer();
  setStatus({ state: 'idle' });
  void clearStoredRecovery().catch((error) => {
    if (token === generation) setStatus({ state: 'unavailable', reason: failureReason(error), lastSuccess: status.lastSuccess });
  });
  try { localStorage.removeItem(LEGACY_RECOVERY_KEY); } catch { /* best effort */ }
}
