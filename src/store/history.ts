import type { Scene } from '../types';
import { useEditorStore } from './editorStore';

/**
 * Undo/redo for scene edits. The store mutates IMMUTABLY (every object mutator rebuilds the `scenes` array via
 * mapActiveSceneObjects, and never touches a prior array/object in place — terrain edits rebuild their override
 * maps too), so an undo snapshot is just a *reference* to `state.scenes` (+ active scene + selection). No deep
 * clone, no serialization — cheap and exact.
 *
 * Capture is automatic via a single store subscription: any change to `scenes` while NOT playing pushes the
 * pre-edit state. Continuous bursts (a gizmo drag, a terrain sculpt stroke, dragging an inspector number field)
 * fire many mutations <COALESCE_MS apart, so they collapse into ONE undo step; deliberate discrete actions are
 * spaced further apart and stay separate.
 */

type HistoryEntry = {
  scenes: Scene[];
  activeSceneId: string;
  selectedObjectId: string;
  selectedObjectIds: string[];
};

const MAX_HISTORY = 80;
// Gap (ms) below which two scene changes are treated as one continuous edit. A drag updates every frame
// (~16–33ms) so it stays grouped; two deliberate clicks are almost always further apart.
const COALESCE_MS = 180;

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
let isTimeTraveling = false;
let lastChangeAt = 0;
let attached = false;

const snapshotFrom = (state: {
  scenes: Scene[];
  activeSceneId: string;
  selectedObjectId: string;
  selectedObjectIds: string[];
}): HistoryEntry => ({
  scenes: state.scenes,
  activeSceneId: state.activeSceneId,
  selectedObjectId: state.selectedObjectId,
  selectedObjectIds: state.selectedObjectIds,
});

const syncDepths = () => {
  const { undoDepth, redoDepth } = useEditorStore.getState();
  if (undoDepth !== undoStack.length || redoDepth !== redoStack.length) {
    useEditorStore.setState({ undoDepth: undoStack.length, redoDepth: redoStack.length });
  }
};

const apply = (entry: HistoryEntry) => {
  isTimeTraveling = true;
  useEditorStore.setState({
    scenes: entry.scenes,
    activeSceneId: entry.activeSceneId,
    selectedObjectId: entry.selectedObjectId,
    selectedObjectIds: entry.selectedObjectIds,
    isDirty: true,
  });
  isTimeTraveling = false;
  lastChangeAt = 0; // the next edit starts a fresh coalesce group
};

export const undo = () => {
  if (!undoStack.length) return;
  redoStack.push(snapshotFrom(useEditorStore.getState()));
  apply(undoStack.pop()!);
  syncDepths();
};

export const redo = () => {
  if (!redoStack.length) return;
  undoStack.push(snapshotFrom(useEditorStore.getState()));
  apply(redoStack.pop()!);
  syncDepths();
};

/** Wipe history — call when a project is created/opened so edits from the old project can't be "undone" into the new one. */
export const clearHistory = () => {
  undoStack.length = 0;
  redoStack.length = 0;
  lastChangeAt = 0;
  syncDepths();
};

/** Attach the capture subscription once. Safe to call repeatedly (no-op after the first). */
export const initHistory = () => {
  if (attached) return;
  attached = true;
  useEditorStore.subscribe((state, prev) => {
    // Only scene-content edits are undoable. Selection/UI/depth changes leave the scenes ref untouched.
    if (state.scenes === prev.scenes) return;
    if (isTimeTraveling) return;
    // Never capture runtime ticks or the Play/Stop transition — gameplay isn't an "edit".
    if (state.isPlaying || prev.isPlaying) return;

    const now = performance.now();
    const continuingBurst = undoStack.length > 0 && now - lastChangeAt < COALESCE_MS;
    lastChangeAt = now;
    if (continuingBurst) return; // top entry already holds this burst's pre-edit state

    undoStack.push(snapshotFrom(prev));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    syncDepths();
  });
};
