import { Profiler, useEffect, type ReactNode } from 'react';
import { profileRender, resetReactProfile } from './runtime/reactProfile';
import { Launcher } from './components/Launcher';
import { useProjectStore } from './store/projectStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { focusWorkspacePanel } from './components/workspacePanels';
import { StatusBar } from './components/StatusBar';
import { ToastHost } from './components/ToastHost';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PackageDetailsDialog } from './components/PackageDetailsDialog';
import { RuntimeConsole } from './components/RuntimeConsole';
import { VariableWatch } from './components/VariableWatch';
import { PrefabThumbnailHost } from './components/PrefabThumbnailer';
import { ModelThumbnailHost } from './components/ModelThumbnailHost';
import { useEditorStore } from './store/editorStore';
import { useMarketplaceStore } from './store/marketplaceStore';
import { useEditorPrefs } from './store/editorPrefsStore';
import { useRuntimeAudio } from './runtime/useRuntimeAudio';
import { recordFrame, resetHitches } from './runtime/perfStats';
import { useGameRuntime, type RuntimeLoopInstrumentation } from './runtime/useGameRuntime';
import { PerfOverlay } from './components/PerfOverlay';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { CommandPalette } from './components/CommandPalette';
import { initHistory } from './store/history';
import { initAutosave } from './store/autosave';
import { initFeatherExternalSync } from './store/featherExternalStore';
import { createMeadowTemplate } from './project/meadowTemplate';
import { createTimelineShowcaseTemplate } from './project/timelineShowcaseTemplate';
import { createSplineStudioTemplate } from './project/splineStudioTemplate';
import { createPlatformerTemplate } from './project/platformerTemplate';

/** DEV-only headless screenshot QA hooks. No-op in production builds and for any other query.
 *  - `?demo=meadows` auto-builds the Meadows template and enters Play (vegetation look).
 *  - `?demo=timeline` builds the Timeline Mechanics gallery for interaction/rendering QA.
 *  - `?demo=spline` builds the asset-free Spline Studio showcase for render QA.
 *  - `?demo=platformer` builds Cloudstep Garden and enters Play for course/HUD QA; add `&qa=motion`
 *    for a short jump/dash capture, `&qa=face` for a front turnaround, `&qa=fall` for Pip's defeat beat,
 *    or `&qa=clear` for completion.
 *  - `?demo=store` just opens a blank project, so the Asset Store has somewhere to install into.
 *  - `?demo=uikit` installs a UI Kit from the store and opens it in the UI panel — the exact
 *    journey where a CSS-driven kit used to preview as unstyled boxes while its page-level rules
 *    repainted the editor. */
let demoStarted = false;

function useDemoAutoload() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo !== 'meadows' && demo !== 'timeline' && demo !== 'spline' && demo !== 'platformer' && demo !== 'store' && demo !== 'script' && demo !== 'uikit') return;
    // StrictMode double-invokes effects; for the multi-await demos that means two racing setups
    // (the second sees installingId already set and no-ops, then reads a project the first is
    // still building). Once is once.
    if (demoStarted) return;
    demoStarted = true;
    void (async () => {
      const project = useProjectStore.getState();
      if (project.hasProject) return;
      await project.newProject(
        demo === 'store'
          ? 'Store Preview'
          : demo === 'script'
            ? 'Script Preview'
            : demo === 'uikit'
              ? 'UI Kit Preview'
              : demo === 'timeline'
                ? 'Timeline Mechanics Preview'
                : demo === 'spline'
                  ? 'Spline Studio Preview'
                  : demo === 'platformer'
                    ? 'Cloudstep Garden Preview'
                    : 'Meadows Preview',
      );
      if (!useProjectStore.getState().hasProject) return;
      if (demo === 'store') return;
      if (demo === 'uikit') {
        const market = useMarketplaceStore.getState();
        await market.load();
        const kit = useMarketplaceStore.getState().packages.find((p) => p.id === (new URLSearchParams(window.location.search).get('kit') ?? 'pkg-feather-ui-arcade-hud'));
        if (!kit) return;
        await useMarketplaceStore.getState().install(kit);
        // A kit installs as a screen document PLUS its components — open the screen, not the last
        // building block to land in the list.
        const docs = useEditorStore.getState().uiDocuments;
        const installed = docs.filter((d) => !d.isComponent).at(-1) ?? docs.at(-1);
        if (installed) {
          useEditorStore.getState().setActiveUIDocument(installed.id);
          focusWorkspacePanel('ui');
        }
        return;
      }
      // `?demo=script` gives the Scripting panel a real graph to render, so the node editor can be
      // screenshot-reviewed. Without it every fresh load shows only the empty-graph welcome screen.
      if (demo === 'script') {
        useEditorStore.getState().createObject('cube');
        // createObject returns void but selects what it made, so read the id back off the store.
        const objectId = useEditorStore.getState().selectedObjectId;
        // health-and-death is damage-driven, so nothing in it ever runs unattacked. For the
        // breakpoint path use rotating-prop, whose Update event fires every frame.
        const armBreakpoint = new URLSearchParams(window.location.search).get('bp') === '1';
        if (objectId) {
          useEditorStore.getState().attachBehaviorPreset(objectId, armBreakpoint ? 'rotating-prop' : 'health-and-death');
        }
        // `?demo=script&bp=1` also arms a breakpoint on the graph's first exec node. The breakpoint
        // dot itself can't be clicked by the headless harness (it can't drive ReactFlow nodes at
        // all — clicking a node doesn't even select it), so this is the only way to exercise
        // pause-on-breakpoint and the auto-reveal end to end.
        if (armBreakpoint) {
          const editor = useEditorStore.getState();
          const graph = editor.activeGraph();
          const target = graph?.nodes.find((node) => node.data.nodeKind?.startsWith('event.'));
          if (target) editor.toggleGraphBreakpoint(target.id);
        }
        return;
      }
      if (demo === 'timeline') {
        await createTimelineShowcaseTemplate();
        return;
      }
      if (demo === 'spline') {
        await createSplineStudioTemplate();
        return;
      }
      if (demo === 'platformer') {
        await createPlatformerTemplate();
        const qa = new URLSearchParams(window.location.search).get('qa');
        setTimeout(() => {
          const editor = useEditorStore.getState();
          if (qa === 'face') {
            const player = editor.activeScene()?.objects.find((object) => object.creatorRoleId === 'player');
            if (player) editor.updateCharacterController(player.id, { cameraOffset: [0, 3.25, 8.2] });
          }
          editor.setPlaying(true);
          if (qa === 'clear') {
            setTimeout(() => useEditorStore.getState().setRuntimeVariableByName('LevelComplete', true), 350);
          } else if (qa === 'motion') {
            setTimeout(() => {
              useEditorStore.getState().setRuntimeKey('KeyW', true);
              useEditorStore.getState().setRuntimeKey('ShiftLeft', true);
            }, 650);
            setTimeout(() => useEditorStore.getState().setRuntimeKey('Space', true), 1100);
            setTimeout(() => useEditorStore.getState().setRuntimeKey('Space', false), 1240);
            setTimeout(() => {
              useEditorStore.getState().setRuntimeKey('KeyW', false);
              useEditorStore.getState().setRuntimeKey('ShiftLeft', false);
            }, 3600);
          } else if (qa === 'fall') {
            setTimeout(() => {
              const current = useEditorStore.getState();
              const objects = current.activeScene()?.objects ?? [];
              const player = objects.find((object) => object.creatorRoleId === 'player');
              const trigger = objects.find((object) => object.name === 'Cloud Sea Respawn Trigger');
              if (player && trigger) {
                useEditorStore.setState({ runtimeTriggers: [{ objectId: trigger.id, otherObjectId: player.id }] });
              }
            }, 850);
          }
        }, 1200);
        return;
      }
      await createMeadowTemplate();
      // Auto-enter Play so a screenshot shows the eye-level third-person game camera (reference framing).
      setTimeout(() => useEditorStore.getState().setPlaying(true), 2000);
    })();
  }, []);
}

/** DEV-only: `?exportTemplate=third-person` converts a starter template into a store `.nfpack`. */
function useTemplateExport() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const key = new URLSearchParams(window.location.search).get('exportTemplate');
    if (!key) return;
    void import('./dev/exportTemplate').then((module) => module.runTemplateExport(key));
  }, []);
}

/**
 * Mirror the user's appearance preferences onto <html> so the global CSS variables
 * (defined in styles.css under [data-theme="..."] / [data-density="..."]) can react
 * without touching individual components.
 */
function AppearanceSync() {
  const themeMode = useEditorPrefs((s) => s.themeMode);
  const accent = useEditorPrefs((s) => s.accent);
  const density = useEditorPrefs((s) => s.density);
  const fontScale = useEditorPrefs((s) => s.fontScale);

  useEffect(() => {
    const root = document.documentElement;
    // DEV-only `?theme=nova` override so appearance work can be screenshot-checked without
    // wiping persisted prefs (they are per-origin and survive between QA runs).
    const override = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('theme') : null;
    root.dataset.theme = override ?? themeMode;
    root.dataset.density = density;
    // Under the override, drop the inline accent so the theme block's own --accent wins and you
    // see the palette as designed rather than blended with a persisted accent.
    if (override) root.style.removeProperty('--accent');
    else root.style.setProperty('--accent', accent);
    root.style.setProperty('--font-scale', String(fontScale));
  }, [themeMode, accent, density, fontScale]);

  return null;
}

/**
 * When a breakpoint pauses Play, take the user to where it stopped — reveal the Scripting panel and
 * switch to the blueprint that owns the node. Lives here rather than in VisualScriptingPanel because
 * the panel may not be open (or even docked) at the moment the breakpoint fires, which is exactly
 * when you most need it revealed.
 */
function useBreakpointFocus() {
  const brokeAt = useEditorStore((state) => state.runtimeBreakNodeId);
  useEffect(() => {
    if (!brokeAt) return;
    const state = useEditorStore.getState();
    const graph = state.graphs.find((item) => item.nodes.some((node) => node.id === brokeAt));
    const blueprint = graph ? state.blueprints.find((item) => item.graphId === graph.id) : undefined;
    // setActiveBlueprint clears the node selection, so switch blueprints BEFORE selecting the node.
    if (blueprint && state.activeBlueprintId !== blueprint.id) state.setActiveBlueprint(blueprint.id);
    state.selectGraphNode(brokeAt);
    focusWorkspacePanel('scripting');
  }, [brokeAt]);
}

const EDITOR_RUNTIME_INSTRUMENTATION: RuntimeLoopInstrumentation = {
  onSessionStart: () => {
    resetHitches();
    resetReactProfile();
  },
  onFrame: recordFrame,
};

function RuntimePreviewLoop() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  useRuntimeAudio();
  useGameRuntime(isPlaying, EDITOR_RUNTIME_INSTRUMENTATION);
  return null;
}

/**
 * Warn before closing/reloading the tab when work would be lost: either the PREFAB EDITOR is open
 * (its transient edit scene is never persisted — serialize strips it) or the project has unsaved
 * changes (`isDirty`). Autosave recovery is a safety net, but a standard confirm dialog is what
 * users expect. Play mode never sets `isDirty`, so previewing a game won't trigger the prompt.
 */
function PrefabEditGuard() {
  const editing = useEditorStore((state) => Boolean(state.editingPrefabId) || state.isDirty);
  useEffect(() => {
    if (!editing) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // required by Chrome to show the confirmation dialog
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editing]);
  return null;
}

export default function App() {
  const hasProject = useProjectStore((state) => state.hasProject);

  // Attach the undo/redo capture + autosave-recovery subscriptions once, for the lifetime of the editor.
  useEffect(() => {
    initHistory();
    initAutosave();
    initFeatherExternalSync();
  }, []);
  useDemoAutoload();
  useBreakpointFocus();
  useTemplateExport();

  if (!hasProject) {
    return (
      <>
        <AppearanceSync />
        <Launcher />
      </>
    );
  }

  // Top-level chrome regions get the same render-attribution wrapper as the dock panels, so a
  // widget re-rendering 60×/s during Play is identifiable in the perf overlay (dev builds).
  const profiled = (id: string, node: ReactNode) => (
    <Profiler id={id} onRender={profileRender}>
      {node}
    </Profiler>
  );

  return (
    <div className="editor-shell">
      <AppearanceSync />
      <RuntimePreviewLoop />
      <PrefabEditGuard />
      {profiled('toolbar', <Toolbar />)}
      <Workspace />
      <StatusBar />
      {profiled('console', <RuntimeConsole />)}
      {profiled('varwatch', <VariableWatch />)}
      <PrefabThumbnailHost />
      <ModelThumbnailHost />
      <PerfOverlay />
      <ToastHost />
      <ConfirmDialog />
      <PackageDetailsDialog />
      <ShortcutsOverlay />
      <CommandPalette />
    </div>
  );
}
