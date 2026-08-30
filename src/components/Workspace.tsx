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
import { TreeBuilderPanel } from './TreeBuilderPanel';
import { AssetStorePanel } from './AssetStorePanel';
import { SceneSettingsPanel } from './SceneSettingsPanel';
import { CinematicPanel } from './CinematicPanel';
import { AgentPanel } from './AIChatWidget';
import { ensureWorkspacePanel, focusWorkspacePanel, getWorkspaceApi, registerPanelDefs, setWorkspaceApi } from './workspacePanels';
import { onPanelClosed } from '../sync/storeSync';
import { POPPABLE_PANELS, openPanelWindow } from '../sync/popoutWindow';
import { extensionRegistry } from '../extensions/host';
import { useExtensionSnapshot } from '../extensions/react';
import { ExtensionPanelBoundary } from '../extensions/ExtensionPanelBoundary';

const LAYOUT_KEY = 'nodeforge.layout';
// Bumped to 14: the Spline-style three-zone default (left sidebar / viewport / contextual
// inspector), plus moving the full editors (Terrain/Tree/Animator/UI) to the bottom dock — they
// broke visibly when tabbed into the Inspector's narrow column. A stale saved layout is discarded
// so existing users actually get the corrected shell.
const LAYOUT_VERSION = 14;

// Where each panel sits when (re)added to the dock — used to restore a panel after
// its popped-out window closes.
type PanelDir = 'left' | 'right' | 'above' | 'below' | 'within';

/** Sidebar widths for the default shell. The Inspector is wider because it carries labelled
 *  field rows; the object/asset list only needs room for a name and a badge. */
const SIDEBAR_WIDTH = 300;
const INSPECTOR_WIDTH = 330;
type PanelDef = {
  component: string;
  title: string;
  ref?: string;
  direction?: PanelDir;
  preferredHeightRatio?: number;
};
const PANEL_DEFS: Record<string, PanelDef> = {
  viewport: { component: 'viewport', title: 'Viewport' },
  // Left creator sidebar — Agent is a first-class surface beside Objects and Assets.
  agent: { component: 'agent', title: 'Agent', ref: 'hierarchy', direction: 'within' },
  hierarchy: { component: 'hierarchy', title: 'Objects', ref: 'viewport', direction: 'left' },
  project: { component: 'project', title: 'Assets', ref: 'hierarchy', direction: 'within' },
  store: { component: 'store', title: 'Store', ref: 'hierarchy', direction: 'within' },
  // Right: the one contextual property panel.
  inspector: { component: 'inspector', title: 'Inspector', ref: 'viewport', direction: 'right' },
  // Right side = property sheets. These are plain forms, so they read fine in a ~330px column
  // and tab in beside the Inspector.
  materials: { component: 'materials', title: 'Material', ref: 'inspector', direction: 'within' },
  particles: { component: 'particles', title: 'Particles', ref: 'inspector', direction: 'within' },
  // Bottom = full editors. Terrain (brush + tabs), Tree (asset list + params), Animator (a state
  // graph) and UI (element tree + canvas) all lay out in two or more columns and visibly break
  // when squeezed into the Inspector's width — labels collide with their own controls.
  terrain: { component: 'terrain', title: 'Terrain', ref: 'viewport', direction: 'below' },
  trees: { component: 'trees', title: 'Tree', ref: 'viewport', direction: 'below' },
  animator: { component: 'animator', title: 'Animator', ref: 'viewport', direction: 'below' },
  ui: { component: 'ui', title: 'UI', ref: 'viewport', direction: 'below' },
  scripting: {
    component: 'scripting',
    title: 'Scripting',
    ref: 'viewport',
    direction: 'below',
    preferredHeightRatio: 0.58,
  },
  cinematic: { component: 'cinematic', title: 'Film Mode', ref: 'viewport', direction: 'below' },
  // Kept registered so old saved layouts and pop-out windows still resolve it, but no longer
  // docked by default — the Inspector shows scene settings when nothing is selected.
  scene: { component: 'scene', title: 'Scene', ref: 'inspector', direction: 'within' },
};

/** Panels the View menu offers, in menu order. Excludes `viewport` (never closable) and `scene`
 *  (folded into the Inspector's no-selection state). */
export const WORKSPACE_PANELS: Array<{ id: string; title: string }> = [
  'agent', 'hierarchy', 'project', 'store', 'inspector',
  'materials', 'terrain', 'trees', 'particles', 'animator', 'ui',
  'scripting', 'cinematic',
].map((id) => ({ id, title: PANEL_DEFS[id].title }));

// Hand the placement table to workspacePanels so focusWorkspacePanel can dock a panel on demand
// instead of no-oping when it isn't already open.
registerPanelDefs(PANEL_DEFS);

/** Open a built-in panel by id (adding it at its usual spot if it isn't docked) and focus it. */
export const openBuiltInPanel = focusWorkspacePanel;

// Each panel is wrapped in a React <Profiler> feeding the perf overlay's render-attribution table
// (dev builds only — onRender is a no-op in production), so a panel re-rendering during Play shows
// up by name instead of as anonymous "react/other" frame time.
const profiled = (id: string, node: ReactNode) => (
  <Profiler id={id} onRender={profileRender}>
    {node}
  </Profiler>
);

// Each Dockview panel just renders the existing panel component (they read stores directly).
const builtInComponents = {
  agent: () => profiled('agent', <AgentPanel />),
  hierarchy: () => profiled('hierarchy', <HierarchyPanel />),
  viewport: () => profiled('viewport', <ViewportPanel />),
  inspector: () => profiled('inspector', <InspectorPanel />),
  project: () => profiled('project', <AssetBrowser />),
  scripting: () => profiled('scripting', <VisualScriptingPanel />),
  materials: () => profiled('materials', <MaterialEditorPanel />),
  terrain: () => profiled('terrain', <TerrainEditorPanel />),
  trees: () => profiled('trees', <TreeBuilderPanel />),
  store: () => profiled('store', <AssetStorePanel />),
  particles: () => profiled('particles', <ParticleSystemEditorPanel />),
  animator: () => profiled('animator', <AnimatorEditorPanel />),
  ui: () => profiled('ui', <UIEditorPanel />),
  scene: () => profiled('scene', <SceneSettingsPanel />),
  cinematic: () => profiled('cinematic', <CinematicPanel />),
};

/** Re-add a panel to the dock (after its popped-out window closes), avoiding duplicates. */
function restoreDockPanel(api: DockviewApi, id: string) {
  if (api.getPanel(id)) return;
  // Built-in panels are placed by the shared helper; extensions carry their own placement.
  if (ensureWorkspacePanel(id)) return;
  const extensionPanel = extensionRegistry.getPanel(id);
  if (!extensionPanel) return;
  const ref = extensionPanel.placement?.referencePanel;
  const direction = extensionPanel.placement?.direction;
  const position = ref && direction && api.getPanel(ref) ? { referencePanel: ref, direction } : undefined;
  api.addPanel({ id, component: extensionPanel.id, title: extensionPanel.title, position });
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

/**
 * Default shell — three zones, modelled on Spline: a single left sidebar, a dominant viewport,
 * and one contextual property panel on the right.
 *
 * The deliberate omission is the bottom dock. Scripting, Film Mode, the Animator and the
 * per-component editors (Material/Terrain/Trees/Particles/UI) are NOT docked up-front: on a blank
 * project they were six empty panels competing for attention and squeezing the viewport into a
 * quarter of the screen. They open on demand from View → Panels, from the command palette, or
 * automatically when you select an object that actually uses them (see revealPanelForSelection).
 */
function buildDefaultLayout(api: DockviewApi) {
  buildShell(api);
}

/**
 * The three zones every preset shares: viewport in the middle, Objects/Assets/Store tabbed into
 * one left sidebar, contextual Inspector on the right. Presets then add their specialist panel.
 */
function buildShell(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  api.addPanel({ id: 'agent', component: 'agent', title: 'Agent', renderer: 'always', inactive: true, position: { referencePanel: 'viewport', direction: 'left' } });
  api.addPanel({ id: 'hierarchy', component: 'hierarchy', title: 'Objects', position: { referencePanel: 'agent', direction: 'within' } });
  api.addPanel({ id: 'project', component: 'project', title: 'Assets', position: { referencePanel: 'agent', direction: 'within' } });
  api.addPanel({ id: 'store', component: 'store', title: 'Store', position: { referencePanel: 'hierarchy', direction: 'within' } });
  api.getPanel('hierarchy')?.api.setActive();
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'viewport', direction: 'right' } });
  // Dockview splits evenly by default, which left the viewport at a third of the window — the
  // thing you are actually building should dominate, so pin the sidebars to a readable fixed
  // width and let the viewport take the rest.
  const availableWidth = api.width || (typeof window === 'undefined' ? 1440 : window.innerWidth);
  const hierarchyWidth = Math.min(SIDEBAR_WIDTH, Math.max(220, Math.round(availableWidth * 0.19)));
  const inspectorWidth = Math.min(INSPECTOR_WIDTH, Math.max(250, Math.round(availableWidth * 0.21)));
  api.getPanel('hierarchy')?.api.setSize({ width: hierarchyWidth });
  api.getPanel('inspector')?.api.setSize({ width: inspectorWidth });
}

/** Add Agent to a pre-Creator saved layout without rebuilding the user's dock. */
function ensureAgentPanel(api: DockviewApi): boolean {
  if (api.getPanel('agent')) return false;
  const referencePanel = api.getPanel('hierarchy') ? 'hierarchy' : api.getPanel('viewport') ? 'viewport' : undefined;
  api.addPanel({
    id: 'agent',
    component: 'agent',
    title: 'Agent',
    renderer: 'always',
    inactive: true,
    position: referencePanel
      ? { referencePanel, direction: referencePanel === 'hierarchy' ? 'within' : 'left' }
      : undefined,
  });
  return true;
}

/** Modeling-first: the bare shell, with the material editor tabbed behind the Inspector. */
function buildModelingLayout(api: DockviewApi) {
  buildShell(api);
  api.addPanel({ id: 'materials', component: 'materials', title: 'Material', position: { referencePanel: 'inspector', direction: 'within' } });
  api.getPanel('inspector')?.api.setActive();
}

/** Scripting-first: graph dominates the bottom half. */
function buildScriptingLayout(api: DockviewApi) {
  buildShell(api);
  const scripting = api.addPanel({ id: 'scripting', component: 'scripting', title: 'Scripting', position: { referencePanel: 'viewport', direction: 'below' } });
  const availableHeight = api.height || (typeof window === 'undefined' ? 900 : window.innerHeight);
  scripting.api.setSize({ height: Math.max(360, Math.round(availableHeight * 0.58)) });
}

/** Animation-first: Animator front-and-centre. */
function buildAnimationLayout(api: DockviewApi) {
  buildShell(api);
  api.addPanel({ id: 'animator', component: 'animator', title: 'Animator', position: { referencePanel: 'viewport', direction: 'below' } });
}

/** Cinematic-first: Film Mode owns the bottom. */
function buildCinematicLayout(api: DockviewApi) {
  buildShell(api);
  api.addPanel({ id: 'cinematic', component: 'cinematic', title: 'Film Mode', position: { referencePanel: 'viewport', direction: 'below' } });
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
  const extensionSnapshot = useExtensionSnapshot();
  const dockComponents = useMemo(
    () => ({
      ...builtInComponents,
      ...Object.fromEntries(
        extensionSnapshot.panels.map((panel) => [
          panel.id,
          () => profiled(
            `extension:${panel.id}`,
            <ExtensionPanelBoundary
              pluginId={panel.pluginId}
              panelId={panel.id}
              title={panel.title}
              render={panel.render}
            />,
          ),
        ]),
      ),
    }),
    [extensionSnapshot],
  );

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
    else if (ensureAgentPanel(event.api)) {
      // Persist the one-time additive migration now; native panel focus/maximize
      // remains transient and does not rebuild this layout.
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout: event.api.toJSON() }));
    }

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
        components={dockComponents}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  );
}
