import type { NodeForgeProject } from '../types';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';

/**
 * Crash/close recovery: while a project has unsaved edits, we debounce a full serialized snapshot
 * into localStorage. On the next launch the Launcher offers to restore it. This is cross-platform
 * (web can't silently write to disk; desktop saving changes files the user didn't ask to touch),
 * so a localStorage recovery snapshot is the safe common denominator — it protects against a tab
 * crash, an accidental reload, or closing the window, without overwriting the user's project file.
 */
const RECOVERY_KEY = 'nodeforge.recovery';
const DEBOUNCE_MS = 4000;
// localStorage is ~5MB; a huge project just means "no recovery this session" rather than a thrown
// quota error mid-edit. (Assets are URLs/paths in the project JSON, not embedded blobs, so most
// projects are well under this.)
const MAX_SNAPSHOT_CHARS = 4_000_000;

export type RecoverySnapshot = {
  name: string;
  dir: string | null;
  savedAt: number;
  project: NodeForgeProject;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let prevDirty = false;

function writeSnapshot() {
  timer = null;
  const editor = useEditorStore.getState();
  const project = useProjectStore.getState();
  if (!project.hasProject || !editor.isDirty) return;
  try {
    const snapshot: RecoverySnapshot = {
      name: project.projectName,
      dir: project.projectDir,
      savedAt: Date.now(),
      project: { ...editor.exportProject(), name: project.projectName },
    };
    const json = JSON.stringify(snapshot);
    if (json.length > MAX_SNAPSHOT_CHARS) return; // too big to stash safely
    localStorage.setItem(RECOVERY_KEY, json);
  } catch {
    // Quota exceeded / serialization issue — skip this autosave silently rather than disrupt editing.
  }
}

/**
 * Subscribe once (call at app start). Debounces a recovery snapshot whenever there are unsaved
 * edits, and clears the snapshot the moment the project becomes clean again (an explicit Save calls
 * markClean → isDirty flips true→false → nothing left to recover).
 */
export function initAutosave() {
  if (started) return;
  started = true;
  prevDirty = useEditorStore.getState().isDirty;
  useEditorStore.subscribe((state) => {
    // Never during Play: the runtime tick churns state every frame and those aren't user edits.
    if (state.isPlaying) {
      prevDirty = state.isDirty;
      return;
    }
    if (prevDirty && !state.isDirty) {
      // Just became clean (saved) — the snapshot is now redundant.
      clearRecovery();
    } else if (state.isDirty) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(writeSnapshot, DEBOUNCE_MS);
    }
    prevDirty = state.isDirty;
  });
}

export function readRecovery(): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoverySnapshot;
    return parsed && parsed.project ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRecovery() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}
