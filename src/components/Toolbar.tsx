import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  Circle,
  Command,
  Copy,
  FolderOpen,
  Gamepad2,
  LampDesk,
  Layers,
  Mountain,
  Package,
  Pause,
  Play,
  Plus,
  Redo2,
  Rocket,
  Save,
  Settings,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { PREFAB_EDIT_SCENE_ID } from '../types';
import { ProblemsButton, RuntimeErrorBadge } from './ProblemsPanel';
import { useEditorStore } from '../store/editorStore';
import { undo, redo } from '../store/history';
import { useProjectStore } from '../store/projectStore';
import { useEditorPrefs } from '../store/editorPrefsStore';
import { applyCustomLayout, applyWorkspaceLayout, resetWorkspaceLayout, WORKSPACE_LAYOUTS } from './Workspace';
import { PreferencesModal } from './PreferencesModal';
import { BuildReportDialog } from './BuildReportDialog';
import type { SceneObjectKind } from '../types';

const creationTools: Array<{ kind: SceneObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'empty', label: 'Empty', icon: Square },
  { kind: 'cube', label: 'Cube', icon: Box },
  { kind: 'sphere', label: 'Sphere', icon: Circle },
  { kind: 'plane', label: 'Plane', icon: Square },
  { kind: 'terrain', label: 'Terrain', icon: Mountain },
  { kind: 'light', label: 'Light', icon: LampDesk },
  { kind: 'camera', label: 'Camera', icon: Camera },
];

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const save = useProjectStore((state) => state.save);
  const saveAs = useProjectStore((state) => state.saveAs);
  const closeProject = useProjectStore((state) => state.closeProject);
  const projectName = useProjectStore((state) => state.projectName);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu" ref={ref}>
      <button className="file-menu-trigger" onClick={() => setOpen((value) => !value)}>
        File
      </button>
      {open && (
        <div className="file-menu-popover">
          <button onClick={run(() => void newProject(`Game ${new Date().getFullYear()}`))}>New project…</button>
          <button onClick={run(() => void openProject())}>Open project…</button>
          <button onClick={run(() => void save())}>Save</button>
          <button onClick={run(() => void saveAs(`${projectName} Copy`))}>Save as…</button>
          <hr />
          <button onClick={run(closeProject)}>Close project</button>
        </div>
      )}
    </div>
  );
}

function AddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const createObject = useEditorStore((state) => state.createObject);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="file-menu" ref={ref}>
      <button className="file-menu-trigger add-trigger" onClick={() => setOpen((value) => !value)}>
        <Plus size={15} aria-hidden />
        <span>Add</span>
      </button>
      {open && (
        <div className="file-menu-popover add-popover">
          {creationTools.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              onClick={() => {
                setOpen(false);
                createObject(kind);
              }}
            >
              <Icon size={15} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const exportGame = useProjectStore((state) => state.exportGame);
  const exportProduction = useProjectStore((state) => state.exportProduction);
  const busy = useProjectStore((state) => state.busy);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    void fn();
  };

  return (
    <div className="file-menu" ref={ref}>
      <button className="export-button" disabled={busy} title="Export your game" onClick={() => setOpen((value) => !value)}>
        <Package size={16} aria-hidden />
        <span>Export</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div className="file-menu-popover add-popover export-popover">
          <button onClick={run(exportGame)}>
            <Package size={15} aria-hidden />
            <span>Game bundle (game.json)</span>
          </button>
          <button onClick={run(exportProduction)}>
            <Rocket size={15} aria-hidden />
            <span>Production — web + native app</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ViewMenu({ onOpenPrefs }: { onOpenPrefs: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const customLayouts = useEditorPrefs((s) => s.customLayouts);
  const customList = useMemo(
    () => Object.values(customLayouts).sort((a, b) => b.savedAt - a.savedAt),
    [customLayouts],
  );

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu" ref={ref}>
      <button className="file-menu-trigger" onClick={() => setOpen((value) => !value)}>
        View
      </button>
      {open && (
        <div className="file-menu-popover">
          <div className="file-menu-section">Layout</div>
          {WORKSPACE_LAYOUTS.map((layout) => (
            <button key={layout.id} onClick={run(() => applyWorkspaceLayout(layout.id))}>
              {layout.label}
            </button>
          ))}
          {customList.length > 0 && (
            <>
              <hr />
              <div className="file-menu-section">Your layouts</div>
              {customList.map((layout) => (
                <button
                  key={layout.name}
                  onClick={run(() => applyCustomLayout(layout.json))}
                  title={`Apply "${layout.name}"`}
                >
                  {layout.name}
                </button>
              ))}
            </>
          )}
          <hr />
          <button onClick={run(() => window.dispatchEvent(new CustomEvent('nf:open-command-palette')))}>Command palette (⌘K)</button>
          <button onClick={run(resetWorkspaceLayout)}>Reset layout</button>
          <button onClick={run(() => window.dispatchEvent(new CustomEvent('nf:open-shortcuts')))}>Keyboard shortcuts (?)</button>
          <button onClick={run(onOpenPrefs)}>Preferences…</button>
        </div>
      )}
    </div>
  );
}

function SaveToast() {
  const toast = useProjectStore((state) => state.toast);
  const clearToast = useProjectStore((state) => state.clearToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clearToast, 2600);
    return () => window.clearTimeout(timer);
  }, [toast, clearToast]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.message}
          className={`save-toast ${toast.kind}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Full-screen overlay showing live output while a production build runs. */
function BuildProgressOverlay() {
  const progress = useProjectStore((state) => state.buildProgress);
  const clearBuildProgress = useProjectStore((state) => state.clearBuildProgress);
  if (!progress) return null;
  return (
    <div className="build-overlay">
      <div className="build-overlay-card">
        <div className="build-overlay-head">
          <Rocket size={16} aria-hidden />
          <strong>Building your game…</strong>
          <button
            className="build-overlay-close"
            title="Hide (the build keeps running)"
            onClick={clearBuildProgress}
          >
            <X size={15} aria-hidden />
          </button>
        </div>
        <p className="build-overlay-hint">
          Compiling a native app + portable web build. This can take a few minutes the first time.
        </p>
        <pre className="build-overlay-log">{progress.lines.slice(-16).join('\n')}</pre>
      </div>
    </div>
  );
}

function SceneSwitcher() {
  // The runtime tick rebuilds `state.scenes` every frame during Play; this switcher only needs the
  // id+name list, so subscribe to a signature of that and derive the list — otherwise the toolbar
  // re-renders 60×/sec while playing.
  const sceneListSig = useEditorStore((state) => state.scenes.map((s) => `${s.id}:${s.name}`).join('|'));
  const scenes = useMemo(
    () => useEditorStore.getState().scenes.map((s) => ({ id: s.id, name: s.name })),
    [sceneListSig],
  );
  const activeSceneId = useEditorStore((state) => state.activeSceneId);
  const setActiveScene = useEditorStore((state) => state.setActiveScene);
  const createScene = useEditorStore((state) => state.createScene);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  const prefabName = useEditorStore((state) =>
    state.prefabs.find((prefab) => prefab.id === state.editingPrefabId)?.name ?? 'Prefab',
  );
  const closePrefabEditor = useEditorStore((state) => state.closePrefabEditor);

  // While editing a prefab the active scene is the transient edit scene — show a dedicated banner
  // with Save/Discard instead of the scene switcher (and never list the edit scene anywhere).
  if (editingPrefabId) {
    return (
      <div className="scene-switcher prefab-editing" title={`Editing prefab "${prefabName}"`}>
        <Boxes size={15} aria-hidden />
        <span className="prefab-editing-label">Editing: {prefabName}</span>
        <button className="icon-button compact" title="Save prefab & close" onClick={() => closePrefabEditor(true)}>
          <Check size={14} aria-hidden />
        </button>
        <button className="icon-button compact danger" title="Discard changes & close" onClick={() => closePrefabEditor(false)}>
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="scene-switcher" title={isPlaying ? 'Stop play to switch scenes' : 'Active scene'}>
      <Layers size={15} aria-hidden />
      <select
        value={activeSceneId}
        disabled={isPlaying}
        onChange={(event) => setActiveScene(event.target.value)}
      >
        {scenes
          .filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)
          .map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
      </select>
      <button
        className="icon-button compact"
        title="Add scene"
        disabled={isPlaying}
        onClick={() => {
          const id = createScene();
          setActiveScene(id);
        }}
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}

export function Toolbar() {
  const duplicateSelectedObject = useEditorStore((state) => state.duplicateSelectedObject);
  const deleteSelectedObject = useEditorStore((state) => state.deleteSelectedObject);
  const createPrefabFromObject = useEditorStore((state) => state.createPrefabFromObject);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const canUndo = useEditorStore((state) => state.undoDepth > 0);
  const canRedo = useEditorStore((state) => state.redoDepth > 0);
  const editingPrefab = useEditorStore((state) => state.editingPrefabId !== null);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  // Subscribe to the selected object's id+name as primitives, not the object itself: the runtime
  // tick replaces the object array every frame, so subscribing to the object would re-render the
  // whole toolbar 60×/sec during Play even though only these two fields are used.
  const selectedObjectId = useEditorStore((state) => state.selectedObject()?.id);
  const selectedObjectName = useEditorStore((state) => state.selectedObject()?.name);
  const isDirty = useEditorStore((state) => state.isDirty);
  const projectName = useProjectStore((state) => state.projectName);
  const save = useProjectStore((state) => state.save);
  const busy = useProjectStore((state) => state.busy);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // ⌘S / Ctrl+S to save.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  return (
    <header className="toolbar">
      <div className="brand">
        <Gamepad2 size={18} aria-hidden />
        <div>
          <strong>Feather</strong>
          <span>Engine</span>
        </div>
      </div>

      <FileMenu />
      <ViewMenu onOpenPrefs={() => setPrefsOpen(true)} />
      <AddMenu />
      <button
        className="cmdk-launch"
        title="Command palette — run any command (⌘K)"
        onClick={() => window.dispatchEvent(new CustomEvent('nf:open-command-palette'))}
      >
        <Command size={13} aria-hidden />
        <span>K</span>
      </button>
      <SceneSwitcher />

      <div className="tool-group" aria-label="History">
        <button className="icon-button" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={17} aria-hidden />
        </button>
        <button className="icon-button" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={17} aria-hidden />
        </button>
      </div>

      <div className="tool-group" aria-label="Object actions">
        <button className="icon-button" title="Duplicate selected object" onClick={duplicateSelectedObject}>
          <Copy size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          title="Save selected object as a reusable Prefab"
          disabled={!selectedObjectId}
          onClick={() => {
            if (!selectedObjectId) return;
            const id = createPrefabFromObject(selectedObjectId);
            useProjectStore.setState({
              toast: id
                ? { kind: 'success', message: `Saved "${selectedObjectName}" as a prefab — see the Project browser.` }
                : { kind: 'error', message: `Couldn't create a prefab from "${selectedObjectName}".` },
            });
          }}
        >
          <Boxes size={17} aria-hidden />
        </button>
        <button className="icon-button danger" title="Delete selected object" onClick={deleteSelectedObject}>
          <Trash2 size={17} aria-hidden />
        </button>
      </div>

      <div className="toolbar-spacer" />

      <SaveToast />
      <BuildProgressOverlay />
      <BuildReportDialog />

      <div className={isDirty ? 'project-pill dirty' : 'project-pill'} title={isDirty ? `${projectName} — unsaved changes (⌘S to save)` : projectName}>
        <span>{projectName}</span>
        {isDirty && (
          <>
            <span className="dirty-dot" />
            <span className="dirty-label">Unsaved</span>
          </>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {selectedObjectId && (
          <motion.div
            key={selectedObjectId}
            className="selection-pill"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <span>{selectedObjectName}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        className="icon-button"
        title="Preferences (theme, layout, density)"
        onClick={() => setPrefsOpen(true)}
      >
        <Settings size={17} aria-hidden />
      </button>

      <div className="tool-group" aria-label="Runtime controls">
        <button
          className={isPlaying ? 'run-button active' : 'run-button'}
          title={editingPrefab ? 'Close the prefab editor to play' : isPlaying ? 'Stop preview' : 'Play preview'}
          disabled={editingPrefab}
          onClick={() => setPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          <span>{isPlaying ? 'Running' : 'Play'}</span>
        </button>
        <RuntimeErrorBadge />
        <ProblemsButton />
        <button className="export-button" title="Save project (⌘S)" onClick={() => void save()} disabled={busy}>
          <Save size={16} aria-hidden />
          <span>Save</span>
        </button>
        <ExportMenu />
      </div>

      <PreferencesModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </header>
  );
}
