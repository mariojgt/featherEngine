import type { ModelSpec, ProjectGraph, Scene, ScriptBlueprint } from '../types';
import { useEditorStore } from './editorStore';
import { canEditCollaborativeProject, collaborationAccess } from '../collaboration/access';

/**
 * Undo/redo for scene edits. The store mutates IMMUTABLY (every object mutator rebuilds the `scenes` array via
 * mapActiveSceneObjects, and never touches a prior array/object in place — terrain edits rebuild their override
 * maps too), so an undo snapshot is just a *reference* to the edited project slices. No deep clone or
 * serialization is needed. Graphs and blueprints are included so code/visual/external-script synchronization
 * remains recoverable with the normal Undo command.
 *
 * Capture is automatic via a single store subscription: any project-content change while NOT playing pushes the
 * pre-edit state. Continuous bursts (a gizmo drag, a terrain sculpt stroke, dragging an inspector number field)
 * fire many mutations <COALESCE_MS apart, so they collapse into ONE undo step; deliberate discrete actions are
 * spaced further apart and stay separate.
 */

type HistoryEntry = {
  scenes: Scene[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  modelSpecs: ModelSpec[];
  activeSceneId: string;
  activeBlueprintId: string;
  activeModelSpecId: string;
  selectedObjectId: string;
  selectedObjectIds: string[];
  selectedGraphNodeId?: string;
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
let historySuppressionDepth = 0;

export interface CollaborationUndoDelegate {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  depths: () => { undo: number; redo: number };
}

let collaborationUndoDelegate: CollaborationUndoDelegate | null = null;

export function setCollaborationUndoDelegate(delegate: CollaborationUndoDelegate | null): void {
  collaborationUndoDelegate = delegate;
  syncDepths();
}

/** Remote CRDT projection is authored state, but it must never enter another user's local undo. */
export function applyWithoutHistory<T>(apply: () => T): T {
  historySuppressionDepth += 1;
  try {
    return apply();
  } finally {
    historySuppressionDepth -= 1;
  }
}

const snapshotFrom = (state: {
  scenes: Scene[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  modelSpecs: ModelSpec[];
  activeSceneId: string;
  activeBlueprintId: string;
  activeModelSpecId: string;
  selectedObjectId: string;
  selectedObjectIds: string[];
  selectedGraphNodeId?: string;
}): HistoryEntry => ({
  scenes: state.scenes,
  blueprints: state.blueprints,
  graphs: state.graphs,
  modelSpecs: state.modelSpecs,
  activeSceneId: state.activeSceneId,
  activeBlueprintId: state.activeBlueprintId,
  activeModelSpecId: state.activeModelSpecId,
  selectedObjectId: state.selectedObjectId,
  selectedObjectIds: state.selectedObjectIds,
  selectedGraphNodeId: state.selectedGraphNodeId,
});

const isExternalCheckpointKey = (key: keyof ScriptBlueprint): boolean =>
  key === 'featherSourceLastSyncedHash' || key === 'featherSourceLastSyncedVisualHash';

/** Disk checkpoints follow real filesystem writes and must not create an edit or clear Redo. */
const blueprintContentChanged = (next: ScriptBlueprint[], previous: ScriptBlueprint[]): boolean => {
  if (next === previous) return false;
  if (next.length !== previous.length) return true;
  return next.some((blueprint, index) => {
    const before = previous[index];
    if (!before || blueprint.id !== before.id) return true;
    const keys = new Set([
      ...(Object.keys(blueprint) as Array<keyof ScriptBlueprint>),
      ...(Object.keys(before) as Array<keyof ScriptBlueprint>),
    ]);
    for (const key of keys) {
      if (!isExternalCheckpointKey(key) && blueprint[key] !== before[key]) return true;
    }
    return false;
  });
};

const shallowChangedExcept = (
  next: Record<string, unknown>,
  previous: Record<string, unknown>,
  ignored: ReadonlySet<string>,
): boolean => {
  const keys = new Set([...Object.keys(next), ...Object.keys(previous)]);
  for (const key of keys) {
    if (!ignored.has(key) && next[key] !== previous[key]) return true;
  }
  return false;
};

const GRAPH_KEYS_TO_IGNORE = new Set(['nodes', 'edges']);
const NODE_KEYS_TO_IGNORE = new Set(['selected', 'dragging']);
const EDGE_KEYS_TO_IGNORE = new Set(['selected']);

const graphContentChanged = (next: ProjectGraph[], previous: ProjectGraph[]): boolean => {
  if (next === previous) return false;
  if (next.length !== previous.length) return true;

  return next.some((graph, graphIndex) => {
    const before = previous[graphIndex];
    if (!before || graph.id !== before.id) return true;
    if (graph === before) return false;
    if (
      shallowChangedExcept(
        graph as unknown as Record<string, unknown>,
        before as unknown as Record<string, unknown>,
        GRAPH_KEYS_TO_IGNORE,
      )
    ) return true;
    if (graph.nodes.length !== before.nodes.length || graph.edges.length !== before.edges.length) return true;
    const nodesChanged = graph.nodes.some((node, nodeIndex) => {
      const priorNode = before.nodes[nodeIndex];
      return (
        !priorNode ||
        node.id !== priorNode.id ||
        (node !== priorNode &&
          shallowChangedExcept(
            node as unknown as Record<string, unknown>,
            priorNode as unknown as Record<string, unknown>,
            NODE_KEYS_TO_IGNORE,
          ))
      );
    });
    if (nodesChanged) return true;
    return graph.edges.some((edge, edgeIndex) => {
      const priorEdge = before.edges[edgeIndex];
      return (
        !priorEdge ||
        edge.id !== priorEdge.id ||
        (edge !== priorEdge &&
          shallowChangedExcept(
            edge as unknown as Record<string, unknown>,
            priorEdge as unknown as Record<string, unknown>,
            EDGE_KEYS_TO_IGNORE,
          ))
      );
    });
  });
};

const syncDepths = () => {
  if (collaborationUndoDelegate) {
    const depths = collaborationUndoDelegate.depths();
    const state = useEditorStore.getState();
    if (state.undoDepth !== depths.undo || state.redoDepth !== depths.redo) {
      useEditorStore.setState({ undoDepth: depths.undo, redoDepth: depths.redo });
    }
    return;
  }
  const { undoDepth, redoDepth } = useEditorStore.getState();
  if (undoDepth !== undoStack.length || redoDepth !== redoStack.length) {
    useEditorStore.setState({ undoDepth: undoStack.length, redoDepth: redoStack.length });
  }
};

const apply = (entry: HistoryEntry) => {
  isTimeTraveling = true;
  const currentBlueprints = useEditorStore.getState().blueprints;
  const blueprints = entry.blueprints.map((restored) => {
    const current = currentBlueprints.find((blueprint) => blueprint.id === restored.id);
    if (!restored.featherSourcePath || restored.featherSourcePath !== current?.featherSourcePath) {
      return restored;
    }
    // Undo restores editor content, but it cannot roll back a real file already written to disk.
    // Keep the current disk/graph checkpoint so linked-source reconciliation recognizes the
    // restored snapshot as a fresh internal edit and writes it out instead of reloading newer disk.
    return {
      ...restored,
      featherSourceLastSyncedHash: current.featherSourceLastSyncedHash,
      featherSourceLastSyncedVisualHash: current.featherSourceLastSyncedVisualHash,
    };
  });
  useEditorStore.setState({
    scenes: entry.scenes,
    blueprints,
    graphs: entry.graphs,
    modelSpecs: entry.modelSpecs,
    activeSceneId: entry.activeSceneId,
    activeBlueprintId: entry.activeBlueprintId,
    activeModelSpecId: entry.activeModelSpecId,
    selectedObjectId: entry.selectedObjectId,
    selectedObjectIds: entry.selectedObjectIds,
    selectedGraphNodeId: entry.selectedGraphNodeId,
    isDirty: true,
  });
  isTimeTraveling = false;
  lastChangeAt = 0; // the next edit starts a fresh coalesce group
};

export const undo = () => {
  if (collaborationUndoDelegate) {
    if (!canEditCollaborativeProject()) return;
    collaborationUndoDelegate.undo();
    syncDepths();
    return;
  }
  if (!undoStack.length) return;
  redoStack.push(snapshotFrom(useEditorStore.getState()));
  apply(undoStack.pop()!);
  syncDepths();
};

export const redo = () => {
  if (collaborationUndoDelegate) {
    if (!canEditCollaborativeProject()) return;
    collaborationUndoDelegate.redo();
    syncDepths();
    return;
  }
  if (!redoStack.length) return;
  undoStack.push(snapshotFrom(useEditorStore.getState()));
  apply(redoStack.pop()!);
  syncDepths();
};

/** Wipe history — call when a project is created/opened so edits from the old project can't be "undone" into the new one. */
export const clearHistory = () => {
  collaborationUndoDelegate?.clear();
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
    // Only project-content edits are undoable. React Flow rebuilds graph references for selection,
    // so compare those transient flags explicitly rather than treating every new array as an edit.
    if (
      state.scenes === prev.scenes &&
      state.modelSpecs === prev.modelSpecs &&
      !blueprintContentChanged(state.blueprints, prev.blueprints) &&
      !graphContentChanged(state.graphs, prev.graphs)
    ) return;
    if (isTimeTraveling) return;
    if (historySuppressionDepth > 0 || collaborationAccess().active) return;
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
