import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Aperture,
  Box,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  Circle,
  CloudUpload,
  Command,
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
  SkipForward,
  Square,
  Store,
  TreePine,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { PREFAB_EDIT_SCENE_ID } from '../types';
import { ProblemsButton, RuntimeErrorBadge } from './ProblemsPanel';
import { useEditorStore } from '../store/editorStore';
import { undo, redo } from '../store/history';
import { useProjectStore } from '../store/projectStore';
import { useEditorPrefs } from '../store/editorPrefsStore';
import { applyCustomLayout, applyWorkspaceLayout, openBuiltInPanel, resetWorkspaceLayout, WORKSPACE_LAYOUTS, WORKSPACE_PANELS } from './Workspace';
import { PreferencesModal } from './PreferencesModal';
import { BuildReportDialog } from './BuildReportDialog';
import type { SceneObjectKind, TreeArchetype } from '../types';
import { focusWorkspacePanel, openWorkspacePanel } from './workspacePanels';
import { askPackageDetails } from '../store/packageDetailsStore';
import { useExtensionSnapshot } from '../extensions/react';
import { useCollaborationStore } from '../store/collaborationStore';
import { CollaborationDialog } from './CollaborationDialog';
import { SteamPublishDialog } from './SteamPublishDialog';
import { isDesktop as runningInDesktopShell } from '../platform';

/** Parametric trees aren't a SceneObjectKind (they're a component), so they get their own Add entries. */
const treeTools: Array<{ archetype: TreeArchetype; label: string }> = [
  { archetype: 'broadleaf', label: 'Tree — Broadleaf' },
  { archetype: 'conifer', label: 'Tree — Conifer' },
  { archetype: 'birch', label: 'Tree — Birch' },
  { archetype: 'willow', label: 'Tree — Willow' },
  { archetype: 'palm', label: 'Tree — Palm' },
  { archetype: 'shrub', label: 'Bush' },
  { archetype: 'snag', label: 'Dead Tree' },
];

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
  const createTree = useEditorStore((state) => state.createTree);
  const createReflectionProbe = useEditorStore((state) => state.createReflectionProbe);
  const createInstancedGrid = useEditorStore((state) => state.createInstancedGrid);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);

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
        <Plus size={14} aria-hidden />
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
              <Icon size={14} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
          <div className="file-menu-section">Rendering</div>
          <button
            onClick={() => {
              setOpen(false);
              createReflectionProbe();
              focusWorkspacePanel('inspector');
            }}
          >
            <Aperture size={14} aria-hidden />
            <span>Reflection Probe</span>
          </button>
          <button
            disabled={!selectedObjectId}
            title="Select a safe static imported model first"
            onClick={() => {
              const ids = createInstancedGrid(selectedObjectId, { rows: 3, columns: 3 });
              setOpen(false);
              if (!ids.length) {
                useProjectStore.setState({
                  toast: { kind: 'error', message: 'Select a root-level static imported model with baked materials to create an instanced grid.' },
                });
                return;
              }
              focusWorkspacePanel('inspector');
            }}
          >
            <Layers size={14} aria-hidden />
            <span>GPU-Instanced Model Grid</span>
          </button>
          <div className="file-menu-section">Trees</div>
          {treeTools.map(({ archetype, label }) => (
            <button
              key={archetype}
              onClick={() => {
                setOpen(false);
                createTree(archetype);
                // The Inspector shares a dock group with Scene and Scene is the default active tab, so
                // without this the new tree's controls are created behind a tab you never thought to click.
                focusWorkspacePanel('inspector');
              }}
            >
              <TreePine size={14} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ onOpenSteam }: { onOpenSteam: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const exportGame = useProjectStore((state) => state.exportGame);
  const exportProduction = useProjectStore((state) => state.exportProduction);
  const exportProjectPackage = useProjectStore((state) => state.exportProjectPackage);
  const projectName = useProjectStore((state) => state.projectName);
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
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="file-menu-popover add-popover export-popover">
          <button onClick={run(exportGame)}>
            <Package size={14} aria-hidden />
            <span>Game bundle (game.json)</span>
          </button>
          <button onClick={run(exportProduction)}>
            <Rocket size={14} aria-hidden />
            <span>Production — web + native app</span>
          </button>
          <hr />
          <button
            onClick={run(onOpenSteam)}
            disabled={!runningInDesktopShell}
            aria-describedby={!runningInDesktopShell ? 'steam-export-desktop-hint' : undefined}
          >
            <CloudUpload size={14} aria-hidden />
            <span>Upload to Steam…{!runningInDesktopShell ? ' (desktop only)' : ''}</span>
          </button>
          {!runningInDesktopShell && (
            <div id="steam-export-desktop-hint" className="export-menu-hint">
              Open this project in Feather desktop to run SteamCMD locally.
            </div>
          )}
          <hr />
          <button
            onClick={run(async () => {
              const meta = await askPackageDetails({
                title: 'Share as template',
                summary: 'Bundles every scene plus everything it references into one .nfpack file.',
                defaults: { name: projectName, version: '1.0.0' },
              });
              if (meta) await exportProjectPackage(meta);
            })}
          >
            <Store size={14} aria-hidden />
            <span>Share as template (.nfpack)</span>
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
  const extensionPanels = useExtensionSnapshot().panels;
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
    <div className="file-menu" data-menu="view" ref={ref}>
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
          <div className="file-menu-section">Panels</div>
          {/* The default shell only docks Objects/Assets/Store, the viewport and the Inspector,
              so every other panel has to be openable from here. */}
          {WORKSPACE_PANELS.map((panel) => (
            <button key={panel.id} onClick={run(() => openBuiltInPanel(panel.id))}>
              <span>{panel.title}</span>
            </button>
          ))}
          {extensionPanels.length > 0 && (
            <>
              <hr />
              <div className="file-menu-section">Extensions</div>
              {extensionPanels.map((panel) => (
                <button key={panel.id} onClick={run(() => openWorkspacePanel(panel))}>
                  {panel.title}
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

/* Save/export/build feedback now flows through the app-wide ToastHost (bridged from
   projectStore.toast), replacing the old single-slot SaveToast that lived here. */

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
            <X size={14} aria-hidden />
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
        <Boxes size={14} aria-hidden />
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
      <Layers size={14} aria-hidden />
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

function CollaborationToolbarButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const status = useCollaborationStore((state) => state.status);
  const sessionName = useCollaborationStore((state) => state.sessionName);
  const participants = useCollaborationStore((state) => state.participants);
  const role = useCollaborationStore((state) => state.role);
  const isLive = status === 'hosting' || status === 'connected' || status === 'reconnecting';
  const isWorking = status === 'starting' || status === 'joining';
  const label = isLive
    ? `${participants.length || 1} live`
    : isWorking
      ? status === 'starting' ? 'Starting…' : 'Joining…'
      : status === 'error' ? 'Reconnect' : 'Collaborate';
  const title = isLive
    ? `${sessionName || 'Live collaboration'} · ${role ? `${role[0].toUpperCase()}${role.slice(1)}` : 'Connected'}`
    : status === 'error' ? 'Collaboration needs attention' : 'Start or join a live editing session';

  return (
    <button
      type="button"
      className={`collaboration-toolbar-button collaboration-status--${status} ${isLive ? 'is-live' : ''}`}
      onClick={onClick}
      title={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="collaboration-toolbar-button"
      data-collaboration-status={status}
    >
      {isLive && participants.length > 0 ? (
        <span className="collaboration-toolbar-faces" aria-hidden>
          {participants.slice(0, 3).map((participant) => (
            <span key={participant.id} style={{ '--participant-color': participant.color } as CSSProperties}>
              {participant.name.trim().slice(0, 1).toUpperCase() || '?'}
            </span>
          ))}
        </span>
      ) : (
        <span className="collaboration-toolbar-icon" aria-hidden>
          <Users size={15} />
          <i className="collaboration-status-dot" />
        </span>
      )}
      <span className="collaboration-toolbar-label">{label}</span>
    </button>
  );
}

export function Toolbar() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const isPlayPaused = useEditorStore((state) => state.isPlayPaused);
  const canUndo = useEditorStore((state) => state.undoDepth > 0);
  const canRedo = useEditorStore((state) => state.redoDepth > 0);
  const editingPrefab = useEditorStore((state) => state.editingPrefabId !== null);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const setPlayPaused = useEditorStore((state) => state.setPlayPaused);
  const stepPlayFrame = useEditorStore((state) => state.stepPlayFrame);
  const isDirty = useEditorStore((state) => state.isDirty);
  const projectName = useProjectStore((state) => state.projectName);
  const save = useProjectStore((state) => state.save);
  const busy = useProjectStore((state) => state.busy);
  const collaborationStatus = useCollaborationStore((state) => state.status);
  const collaborationRole = useCollaborationStore((state) => state.role);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [steamPublishOpen, setSteamPublishOpen] = useState(false);
  const guestProjectLock = collaborationRole !== null
    && collaborationRole !== 'host'
    && collaborationStatus !== 'idle';

  // ⌘S / Ctrl+S to save; F6 pause / F7 step during Play.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === 'F6') {
        event.preventDefault();
        const state = useEditorStore.getState();
        if (!state.isPlaying) return;
        state.setPlayPaused(!state.isPlayPaused);
        return;
      }
      if (event.key === 'F7') {
        event.preventDefault();
        useEditorStore.getState().stepPlayFrame();
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
        <Command size={14} aria-hidden />
        <span>K</span>
      </button>
      <SceneSwitcher />

      <div className="tool-group" aria-label="History">
        <button className="icon-button" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} aria-hidden />
        </button>
        <button className="icon-button" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} aria-hidden />
        </button>
      </div>

      {/* Duplicate / Create Prefab / Delete used to live here. They are all on the object's
          right-click menu in Objects, which is where people look for selection actions anyway —
          three permanent top-bar buttons for them was duplicate surface, and two of them didn't
          even grey out when nothing was selected. */}

      <div className="toolbar-spacer" />

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

      {/* No settings cog: View → Preferences… opens the same modal. */}

      <CollaborationToolbarButton open={collaborationOpen} onClick={() => setCollaborationOpen(true)} />

      <div className="tool-group" aria-label="Runtime controls">
        <button
          className={isPlaying ? 'run-button active' : 'run-button'}
          title={guestProjectLock ? 'Only the collaboration host can run the shared simulation' : editingPrefab ? 'Close the prefab editor to play' : isPlaying ? 'Stop preview' : 'Play preview'}
          disabled={editingPrefab || guestProjectLock}
          onClick={() => setPlaying(!isPlaying)}
          data-testid="toolbar-play-button"
        >
          {isPlaying ? <Square size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>
        {/* Pause and frame-step are only meaningful mid-preview — permanently greyed-out buttons
            are two more things to read past every time you look at the toolbar. */}
        {isPlaying && (
          <>
            <button
              className={isPlayPaused ? 'icon-button active' : 'icon-button'}
              title="Pause preview (F6)"
              onClick={() => setPlayPaused(!isPlayPaused)}
            >
              <Pause size={16} aria-hidden />
            </button>
            <button className="icon-button" title="Step one frame (F7)" onClick={() => stepPlayFrame()}>
              <SkipForward size={16} aria-hidden />
            </button>
          </>
        )}
        <RuntimeErrorBadge />
        <ProblemsButton />
        <button
          className="export-button"
          title={guestProjectLock ? 'Only the collaboration host can save project files' : 'Save project (⌘S)'}
          onClick={() => void save()}
          disabled={busy || guestProjectLock}
          data-testid="toolbar-save-button"
        >
          <Save size={16} aria-hidden />
          <span>Save</span>
        </button>
        <ExportMenu onOpenSteam={() => setSteamPublishOpen(true)} />
      </div>

      <PreferencesModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
      <CollaborationDialog open={collaborationOpen} onClose={() => setCollaborationOpen(false)} />
      <SteamPublishDialog open={steamPublishOpen} onClose={() => setSteamPublishOpen(false)} />
    </header>
  );
}
