import { Profiler, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { profileRender } from '../runtime/reactProfile';
import {
  DockviewReact,
  themeAbyss,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { ExternalLink, PictureInPicture2 } from 'lucide-react';
import { useEditorPrefs } from '../store/editorPrefsStore';
import { HierarchyPanel } from './HierarchyPanel';
import { ViewportPanel } from './Viewport';
import { InspectorPanel } from './InspectorPanel';
import { AssetBrowser } from './AssetBrowser';
import { VisualScriptingPanel } from './VisualScriptingPanel';
import { MaterialEditorPanel } from './MaterialEditorPanel';
import { ParticleSystemEditorPanel } from './ParticleSystemEditorPanel';
import { AnimatorEditorPanel } from './AnimatorEditorPanel';
import { UIEditorPanel } from './UIEditorPanel';
import { TerrainEditorPanel } from './TerrainEditorPanel';
import { SceneSettingsPanel } from './SceneSettingsPanel';
import { CinematicPanel } from './CinematicPanel';
import { getWorkspaceApi, setWorkspaceApi } from './workspacePanels';
import { onPanelClosed } from '../sync/storeSync';
import { POPPABLE_PANELS, openPanelWindow } from '../sync/popoutWindow';

const LAYOUT_KEY = 'nodeforge.layout';
const LAYOUT_VERSION = 10;

// Where each panel sits when (re)added to the dock — used to restore a panel after
// its popped-out window closes.
type PanelDir = 'left' | 'right' | 'above' | 'below' | 'within';
type PanelDef = { component: string; title: string; ref?: string; direction?: PanelDir };
const PANEL_DEFS: Record<string, PanelDef> = {
  viewport: { component: 'viewport', title: 'Viewport' },
  hierarchy: { component: 'hierarchy', title: 'Hierarchy', ref: 'viewport', direction: 'left' },
  inspector: { component: 'inspector', title: 'Inspector', ref: 'viewport', direction: 'right' },
  scripting: { component: 'scripting', title: 'Scripting', ref: 'viewport', direction: 'below' },
  project: { component: 'project', title: 'Project', ref: 'hierarchy', direction: 'below' },
  materials: { component: 'materials', title: 'Material', ref: 'inspector', direction: 'below' },
  terrain: { component: 'terrain', title: 'Terrain', ref: 'materials', direction: 'within' },
  particles: { component: 'particles', title: 'Particle System', ref: 'materials', direction: 'within' },
  animator: { component: 'animator', title: 'Animator', ref: 'inspector', direction: 'below' },
  ui: { component: 'ui', title: 'UI', ref: 'inspector', direction: 'below' },
  scene: { component: 'scene', title: 'Scene', ref: 'inspector', direction: 'within' },
  // Film Mode is a Sequencer — it wants width, so it docks along the bottom next to Scripting.
  cinematic: { component: 'cinematic', title: 'Film Mode', ref: 'scripting', direction: 'within' },
};

// Each panel is wrapped in a React <Profiler> feeding the perf overlay's render-attribution table
// (dev builds only — onRender is a no-op in production), so a panel re-rendering during Play shows
// up by name instead of as anonymous "react/other" frame time.
const profiled = (id: string, node: ReactNode) => (
  <Profiler id={id} onRender={profileRender}>
    {node}
  </Profiler>
);

// Each Dockview panel just renders the existing panel component (they read stores directly).
const components = {
  hierarchy: () => profiled('hierarchy', <HierarchyPanel />),
  viewport: () => profiled('viewport', <ViewportPanel />),
  inspector: () => profiled('inspector', <InspectorPanel />),
  project: () => profiled('project', <AssetBrowser />),
  scripting: () => profiled('scripting', <VisualScriptingPanel />),
  materials: () => profiled('materials', <MaterialEditorPanel />),
  terrain: () => profiled('terrain', <TerrainEditorPanel />),
  particles: () => profiled('particles', <ParticleSystemEditorPanel />),
  animator: () => profiled('animator', <AnimatorEditorPanel />),
  ui: () => profiled('ui', <UIEditorPanel />),
  scene: () => profiled('scene', <SceneSettingsPanel />),
  cinematic: () => profiled('cinematic', <CinematicPanel />),
};

/** Re-add a panel to the dock (after its popped-out window closes), avoiding duplicates. */
function restoreDockPanel(api: DockviewApi, id: string) {
  if (api.getPanel(id)) return;
  const def = PANEL_DEFS[id];
  if (!def) return;
  // Position relative to its usual neighbour, but fall back to a plain add if that's gone.
  const position = def.ref && def.direction && api.getPanel(def.ref) ? { referencePanel: def.ref, direction: def.direction } : undefined;
  api.addPanel({ id, component: def.component, title: def.title, position });
}

/** Pop a panel out into its own OS window and remove it from the dock (restored on close). */
async function popOutPanel(api: DockviewApi, panelId: string) {
  const opened = await openPanelWindow(panelId);
  if (opened) api.getPanel(panelId)?.api.close();
}

/**
 * Header buttons for each group:
 *  - Float: detach in-app (a div inside this window — clipped to the window bounds).
 *  - Popout: open the panel in a real OS-level window (Tauri WebviewWindow / window.open)
 *    so it can move outside the main window. Not shown for the viewport (WebGL can't move).
 */
function HeaderActions(props: IDockviewHeaderActionsProps) {
  const isFloating = props.location?.type === 'floating';
  const panelId = props.activePanel?.id;
  const canPopOut = !!panelId && panelId in POPPABLE_PANELS;
  return (
    <div className="dv-header-actions">
      {!isFloating && (
        <button
          className="dv-float-action"
          title="Float this panel (stays inside the window)"
          aria-label="Float this panel"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.containerApi.addFloatingGroup(props.group)}
        >
          <PictureInPicture2 size={14} aria-hidden />
        </button>
      )}
      {canPopOut && (
        <button
          className="dv-float-action"
          title="Pop out to a separate window"
          aria-label="Pop out panel to a separate window"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            void popOutPanel(props.containerApi, panelId);
          }}
        >
          <ExternalLink size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  // Keep the viewport always-rendered so its WebGL context survives tab/float changes.
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Hierarchy', position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
  api.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'scripting', component: 'scripting', title: 'Scripting', position: { referencePanel: 'viewport', direction: 'below' } });
  api.addPanel({ id: 'project', component: 'project', title: 'Project', position: { referencePanel: 'hierarchy', direction: 'below' } });
  api.addPanel({ id: 'materials', component: 'materials', title: 'Material', position: { referencePanel: 'inspector', direction: 'below' } });
  api.addPanel({ id: 'terrain', component: 'terrain', title: 'Terrain', position: { referencePanel: 'materials', direction: 'within' } });
  // Animator shares the Material group as a tab (both author reusable assets next to the Inspector).
  api.addPanel({ id: 'animator', component: 'animator', title: 'Animator', position: { referencePanel: 'materials', direction: 'within' } });
  // UI editor joins the same group as another tab.
  api.addPanel({ id: 'ui', component: 'ui', title: 'UI', position: { referencePanel: 'materials', direction: 'within' } });
  api.addPanel({ id: 'particles', component: 'particles', title: 'Particle System', position: { referencePanel: 'materials', direction: 'within' } });
  // Film Mode is a wide Sequencer — dock it along the bottom as a tab beside Scripting.
  api.addPanel({ id: 'cinematic', component: 'cinematic', title: 'Film Mode', position: { referencePanel: 'scripting', direction: 'within' } });
}

/** Modeling-first layout: big viewport with Hierarchy/Inspector hugging the sides. No Scripting at the bottom. */
function buildModelingLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Hierarchy', position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'project', component: 'project', title: 'Project', position: { referencePanel: 'hierarchy', direction: 'below' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
  api.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'materials', component: 'materials', title: 'Material', position: { referencePanel: 'inspector', direction: 'below' } });
  api.addPanel({ id: 'terrain', component: 'terrain', title: 'Terrain', position: { referencePanel: 'materials', direction: 'within' } });
  api.addPanel({ id: 'particles', component: 'particles', title: 'Particle System', position: { referencePanel: 'materials', direction: 'within' } });
}

/** Scripting-first: graph dominates the bottom half. */
function buildScriptingLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'scripting', component: 'scripting', title: 'Scripting', position: { referencePanel: 'viewport', direction: 'right' } });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Hierarchy', position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'project', component: 'project', title: 'Project', position: { referencePanel: 'hierarchy', direction: 'below' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'scripting', direction: 'right' } });
  api.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'inspector', direction: 'within' } });
}

/** Animation-first: Animator front-and-centre, Inspector + Hierarchy nearby. */
function buildAnimationLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'animator', component: 'animator', title: 'Animator', position: { referencePanel: 'viewport', direction: 'below' } });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Hierarchy', position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
  api.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'inspector', direction: 'within' } });
  api.addPanel({ id: 'project', component: 'project', title: 'Project', position: { referencePanel: 'hierarchy', direction: 'below' } });
}

/** Cinematic-first: Film Mode owns the bottom; everything else collapses around the viewport. */
function buildCinematicLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'cinematic', component: 'cinematic', title: 'Film Mode', position: { referencePanel: 'viewport', direction: 'below' } });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Hierarchy', position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
  api.addPanel({ id: 'scene', component: 'scene', title: 'Scene', position: { referencePanel: 'inspector', direction: 'within' } });
}

export type WorkspaceLayoutId = 'default' | 'modeling' | 'scripting' | 'animation' | 'cinematic';

export const WORKSPACE_LAYOUTS: Array<{ id: WorkspaceLayoutId; label: string; build: (api: DockviewApi) => void }> = [
  { id: 'default', label: 'Default', build: buildDefaultLayout },
  { id: 'modeling', label: 'Modeling', build: buildModelingLayout },
  { id: 'scripting', label: 'Scripting', build: buildScriptingLayout },
  { id: 'animation', label: 'Animation', build: buildAnimationLayout },
  { id: 'cinematic', label: 'Cinematic', build: buildCinematicLayout },
];

/** Rebuild the default layout (wired to the toolbar's View → Reset Layout). */
export function resetWorkspaceLayout() {
  const api = getWorkspaceApi();
  if (api) buildDefaultLayout(api);
}

/** Apply a built-in workspace layout by id. */
export function applyWorkspaceLayout(id: WorkspaceLayoutId) {
  const api = getWorkspaceApi();
  if (!api) return;
  const preset = WORKSPACE_LAYOUTS.find((l) => l.id === id);
  if (preset) preset.build(api);
}

/** Apply a previously-saved custom layout (Dockview JSON). Returns true on success. */
export function applyCustomLayout(json: unknown): boolean {
  const api = getWorkspaceApi();
  if (!api || !json) return false;
  try {
    api.fromJSON(json as Parameters<typeof api.fromJSON>[0]);
    return true;
  } catch {
    return false;
  }
}

/** Snapshot the current Dockview layout as JSON (for saving as a custom preset). */
export function snapshotWorkspaceLayout(): unknown | null {
  const api = getWorkspaceApi();
  return api ? api.toJSON() : null;
}

export function Workspace() {
  const onReady = useCallback((event: DockviewReadyEvent) => {
    setWorkspaceApi(event.api);

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.version === LAYOUT_VERSION && parsed.layout) {
          event.api.fromJSON(parsed.layout);
          restored = true;
        }
      } catch {
        // Corrupt/old layout — fall back to default.
      }
    }
    if (!restored) buildDefaultLayout(event.api);

    event.api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout: event.api.toJSON() }));
    });
  }, []);

  // When a popped-out panel window closes, bring its panel back into the dock.
  useEffect(
    () =>
      onPanelClosed((kind) => {
        const api = getWorkspaceApi();
        if (api) restoreDockPanel(api, kind);
      }),
    [],
  );

  const themeMode = useEditorPrefs((s) => s.themeMode);
  const dockTheme = useMemo(() => {
    if (themeMode === 'light') return themeLight;
    if (themeMode === 'midnight') return themeDark;
    return themeAbyss;
  }, [themeMode]);

  return (
    <div className="nf-dockview-host">
      <DockviewReact
        theme={dockTheme}
        components={components}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  );
}
