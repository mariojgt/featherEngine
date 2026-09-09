import { ObjectCreationMenu } from './ObjectCreationMenu';
import { handleEditorMenuKeyDown } from './editorMenuNavigation';
import { createPortal } from 'react-dom';
import { getPlatform } from '../platform';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Boxes,
  Check,
  ChevronDown,
  CloudUpload,
  Command,
  Gamepad2,
  Layers,
  Package,
  Pause,
  Play,
  Redo2,
  Rocket,
  Save,
  SkipForward,
  Square,
  Store,
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
import { focusWorkspacePanel, openWorkspacePanel, restoreWorkspaceLayout } from './workspacePanels';
import { askPackageDetails } from '../store/packageDetailsStore';
import { useExtensionSnapshot } from '../extensions/react';
import { useCollaborationStore } from '../store/collaborationStore';
import { CollaborationDialog } from './CollaborationDialog';
import { SteamPublishDialog } from './SteamPublishDialog';
import { isDesktop as runningInDesktopShell } from '../platform';
import { resolveCreatorEditorMode, useCreatorEditorModeStore } from '../creator/editorModeStore';

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const save = useProjectStore((state) => state.save);
  const saveAs = useProjectStore((state) => state.saveAs);
  const isPlaying = useEditorStore((state) => state.isPlaying);
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
      <button className="file-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        File
      </button>
      {open && (
        <div className="file-menu-popover" role="menu" onKeyDown={handleEditorMenuKeyDown}>
          <button onClick={run(() => void newProject(`Game ${new Date().getFullYear()}`))}>New project…</button>
          <button onClick={run(() => void openProject())}>Open project…</button>
          <hr />
          <button disabled={isPlaying} title={isPlaying ? 'Stop preview to create a scene' : 'Create and switch to an empty scene'} onClick={run(() => { const editor = useEditorStore.getState(); editor.setActiveScene(editor.createScene()); })}>New scene</button>
          <hr />
          <button onClick={run(() => void save())}>Save project <kbd>⌘S</kbd></button>
          <button onClick={run(() => void saveAs(`${projectName} Copy`))}>Save as…</button>
          <hr />
          <button onClick={run(closeProject)}>Close project</button>
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
      <button className="export-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} title="Export your game" onClick={() => setOpen((value) => !value)}>
        <Package size={16} aria-hidden />
        <span>Export</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="file-menu-popover add-popover export-popover" role="menu" onKeyDown={handleEditorMenuKeyDown}>
          <button onClick={run(exportGame)}>
            <Package size={14} aria-hidden />
            <span>Game data bundle…</span>
          </button>
          <button onClick={run(exportProduction)}>
            <Rocket size={14} aria-hidden />
            <span>Build game for web / desktop…</span>
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
      <button className="file-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        View
      </button>
      {open && (
        <div className="file-menu-popover" role="menu" onKeyDown={handleEditorMenuKeyDown}>
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
  const clear = useProjectStore((state) => state.clearBuildProgress);
  if (!progress) return null;
  const title = progress.running ? 'Building your game…' : progress.status === 'failed' ? 'Build needs attention' : progress.status === 'staged' ? 'Build package ready' : 'Export finished';
  return createPortal(
    <div className="build-overlay">
      <div className="build-overlay-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="build-overlay-head">
          <Rocket size={16} aria-hidden /><strong>{title}</strong>
          <button className="build-overlay-close" title={progress.running ? 'Hide (the build keeps running)' : 'Close'} onClick={clear}><X size={14} aria-hidden /></button>
        </div>
        <p className="build-overlay-hint">{progress.running ? 'Building the selected platforms. The first build may take a few minutes.' : progress.status === 'staged' ? 'Next: compile the package, then test the output.' : 'Review the output below. The build report distinguishes completed artifacts from staged packages.'}</p>
        <pre className="build-overlay-log" aria-live="polite">{progress.lines.slice(-24).join('\n')}</pre>
        {!progress.running && <div className="build-output-actions">
          {progress.output && <button className="prefs-primary-button" onClick={() => void getPlatform().then((platform) => platform.revealFile?.(progress.output!)).catch((error: unknown) => useProjectStore.setState({ toast: { kind: 'error', message: String(error) } }))}>Open output folder</button>}
          {progress.status === 'failed' && <button className="prefs-primary-button" onClick={() => { clear(); void useProjectStore.getState().exportProduction(); }}>Review and retry</button>}
          <button className="prefs-link-button" onClick={clear}>Done</button>
        </div>}
      </div>
    </div>, document.body,
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
      <span className="editor-scene-label">Scene</span>
      <select
        aria-label="Active scene"
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
  const authoringMode = useCreatorEditorModeStore((state) => state.authoringMode);
  const setAuthoringMode = useCreatorEditorModeStore((state) => state.setAuthoringMode);
  const editorMode = resolveCreatorEditorMode(isPlaying, authoringMode);
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

  const activateBuild = () => {
    setAuthoringMode('build');
    if (useEditorStore.getState().isPlaying) setPlaying(false);
    restoreWorkspaceLayout();
    focusWorkspacePanel('viewport');
  };

  const activatePlay = () => {
    if (useEditorStore.getState().isPlaying) {
      activateBuild();
      return;
    }
    // PLAY is runtime state, not another Creator store value. Reset the
    // authoring destination first so every exit from preview returns to BUILD.
    setAuthoringMode('build');
    restoreWorkspaceLayout();
    focusWorkspacePanel('viewport');
    setPlaying(true);
  };

  const activateLogic = () => {
    if (useEditorStore.getState().isPlaying) setPlaying(false);
    restoreWorkspaceLayout();
    setAuthoringMode('logic');
    // This reuses the live panel when present and only docks it on first use.
    // No Dockview layout rebuild means the graph/code editor keeps local state.
    focusWorkspacePanel('scripting');
  };

  // Runtime entry can also come from the viewport, command palette, or Film
  // Mode. Keep the post-preview authoring destination consistent in every case.
  useEffect(() => {
    if (isPlaying) setAuthoringMode('build');
  }, [isPlaying, setAuthoringMode]);

  // ⌘S / Ctrl+S to save; Escape returns Play → Build; F6/F7 pause/step.
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
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        const state = useEditorStore.getState();
        if (!state.isPlaying) return;
        event.preventDefault();
        useCreatorEditorModeStore.getState().setAuthoringMode('build');
        state.setPlaying(false);
        restoreWorkspaceLayout();
        focusWorkspacePanel('viewport');
        return;
      }
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
    <header onKeyDown={(event) => {
      const target = event.target as HTMLElement;
      const menu = target.closest('.file-menu');
      if (!menu) return;
      const trigger = menu.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
      if (event.key === 'Escape' && trigger?.getAttribute('aria-expanded') === 'true') { event.preventDefault(); event.stopPropagation(); trigger.click(); trigger.focus(); }
      if (event.key === 'ArrowDown' && target === trigger) { event.preventDefault(); if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click(); requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('.file-menu-popover button:not(:disabled)')?.focus()); }
    }} className={`toolbar creator-toolbar creator-mode--${editorMode}`}>
      <div className="editor-main-menu">
      <div className="brand">
        <Gamepad2 size={18} aria-hidden />
        <div>
          <strong>Feather</strong>
          <span>Engine</span>
        </div>
      </div>

        <FileMenu />
        <ViewMenu onOpenPrefs={() => setPrefsOpen(true)} />
        <div className={isDirty ? 'project-pill dirty' : 'project-pill'} title={projectName}><span>{projectName}</span>{isDirty && <span className="dirty-label">Unsaved</span>}</div>
        <div className="toolbar-spacer" />
        <CollaborationToolbarButton open={collaborationOpen} onClick={() => setCollaborationOpen(true)} />
        <ExportMenu onOpenSteam={() => setSteamPublishOpen(true)} />
      </div>
      <div className="editor-main-tools">
      <div className="creator-toolbar-authoring">
        <ObjectCreationMenu />
        <button
          className="cmdk-launch"
          title="Search commands (⌘K / Ctrl+K)" aria-label="Search commands"
          onClick={() => window.dispatchEvent(new CustomEvent('nf:open-command-palette'))}
        >
          <Command size={14} aria-hidden />
          <span>K</span>
        </button>
        <SceneSwitcher />

        <div className="tool-group" aria-label="History">
          <button className="icon-button" title="Undo (⌘Z / Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2 size={16} aria-hidden />
          </button>
          <button className="icon-button" title="Redo (⇧⌘Z / Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 size={16} aria-hidden />
          </button>
        </div>
      </div>

      {/* Duplicate / Create Prefab / Delete used to live here. They are all on the object's
          right-click menu in Objects, which is where people look for selection actions anyway —
          three permanent top-bar buttons for them was duplicate surface, and two of them didn't
          even grey out when nothing was selected. */}

      <div className="toolbar-spacer toolbar-spacer--before-modes" />

      <div className="creator-mode-switch" role="group" aria-label="Editor mode">
        <button
          type="button"
          className={editorMode === 'build' ? 'active' : undefined}
          data-creator-mode="build"
          aria-pressed={editorMode === 'build'}
          onClick={activateBuild}
        >
          Edit
        </button>
        <button
          type="button"
          className={editorMode === 'play' ? 'run-button active play' : 'run-button play'}
          data-creator-mode="play"
          aria-pressed={editorMode === 'play'}
          title={guestProjectLock ? 'Only the collaboration host can run the shared simulation' : editingPrefab ? 'Close the prefab editor to play' : isPlaying ? 'Stop preview and return to editing (Esc)' : 'Play scene'}
          disabled={!isPlaying && (editingPrefab || guestProjectLock)}
          onClick={activatePlay}
          data-testid="toolbar-play-button"
        >
          {isPlaying ? <Square size={12} aria-hidden /> : <Play size={12} aria-hidden />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>
        <button
          type="button"
          className={editorMode === 'logic' ? 'active' : undefined}
          data-creator-mode="logic"
          aria-pressed={editorMode === 'logic'}
          onClick={activateLogic}
        >
          Script
        </button>
      </div>

      {isPlaying && (
        <div className="creator-play-tools" aria-label="Play controls">
          <button
            className={isPlayPaused ? 'icon-button active' : 'icon-button'}
            title={isPlayPaused ? 'Resume preview (F6)' : 'Pause preview (F6)'}
            aria-pressed={isPlayPaused}
            aria-label={isPlayPaused ? 'Resume preview' : 'Pause preview'}
            onClick={() => setPlayPaused(!isPlayPaused)}
          >
            <Pause size={15} aria-hidden />
          </button>
          <button className="icon-button" title="Step one frame (F7)" aria-label="Step one frame" onClick={() => stepPlayFrame()}>
            <SkipForward size={15} aria-hidden />
          </button>
        </div>
      )}

      <div className="toolbar-spacer toolbar-spacer--after-modes" />

      <BuildProgressOverlay />
      <BuildReportDialog />

      <div className="tool-group" aria-label="Runtime controls">
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
      </div>
      </div>

      <PreferencesModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
      <CollaborationDialog open={collaborationOpen} onClose={() => setCollaborationOpen(false)} />
      <SteamPublishDialog open={steamPublishOpen} onClose={() => setSteamPublishOpen(false)} />
    </header>
  );
}
