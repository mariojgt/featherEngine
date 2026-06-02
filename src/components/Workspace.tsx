import { useCallback, useEffect } from 'react';
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { ExternalLink, PictureInPicture2 } from 'lucide-react';
import { HierarchyPanel } from './HierarchyPanel';
import { ViewportPanel } from './Viewport';
import { InspectorPanel } from './InspectorPanel';
import { AssetBrowser } from './AssetBrowser';
import { VisualScriptingPanel } from './VisualScriptingPanel';
import { MaterialEditorPanel } from './MaterialEditorPanel';
import { ParticleSystemEditorPanel } from './ParticleSystemEditorPanel';
import { AnimatorEditorPanel } from './AnimatorEditorPanel';
import { UIEditorPanel } from './UIEditorPanel';
import { SceneSettingsPanel } from './SceneSettingsPanel';
import { CinematicPanel } from './CinematicPanel';
import { getWorkspaceApi, setWorkspaceApi } from './workspacePanels';
import { onPanelClosed } from '../sync/storeSync';
import { POPPABLE_PANELS, openPanelWindow } from '../sync/popoutWindow';

const LAYOUT_KEY = 'nodeforge.layout';
const LAYOUT_VERSION = 8;

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
  particles: { component: 'particles', title: 'Particle System', ref: 'materials', direction: 'within' },
  animator: { component: 'animator', title: 'Animator', ref: 'inspector', direction: 'below' },
  ui: { component: 'ui', title: 'UI', ref: 'inspector', direction: 'below' },
  scene: { component: 'scene', title: 'Scene', ref: 'inspector', direction: 'within' },
  cinematic: { component: 'cinematic', title: 'Film Mode', ref: 'materials', direction: 'within' },
};

// Each Dockview panel just renders the existing panel component (they read stores directly).
const components = {
  hierarchy: () => <HierarchyPanel />,
  viewport: () => <ViewportPanel />,
  inspector: () => <InspectorPanel />,
  project: () => <AssetBrowser />,
  scripting: () => <VisualScriptingPanel />,
  materials: () => <MaterialEditorPanel />,
  particles: () => <ParticleSystemEditorPanel />,
  animator: () => <AnimatorEditorPanel />,
  ui: () => <UIEditorPanel />,
  scene: () => <SceneSettingsPanel />,
  cinematic: () => <CinematicPanel />,
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.containerApi.addFloatingGroup(props.group)}
        >
          <PictureInPicture2 size={13} aria-hidden />
        </button>
      )}
      {canPopOut && (
        <button
          className="dv-float-action"
          title="Pop out to a separate window"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            void popOutPanel(props.containerApi, panelId);
          }}
        >
          <ExternalLink size={13} aria-hidden />
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
  // Animator shares the Material group as a tab (both author reusable assets next to the Inspector).
  api.addPanel({ id: 'animator', component: 'animator', title: 'Animator', position: { referencePanel: 'materials', direction: 'within' } });
  // UI editor joins the same group as another tab.
  api.addPanel({ id: 'ui', component: 'ui', title: 'UI', position: { referencePanel: 'materials', direction: 'within' } });
  api.addPanel({ id: 'particles', component: 'particles', title: 'Particle System', position: { referencePanel: 'materials', direction: 'within' } });
  api.addPanel({ id: 'cinematic', component: 'cinematic', title: 'Film Mode', position: { referencePanel: 'materials', direction: 'within' } });
}

/** Rebuild the default layout (wired to the toolbar's View → Reset Layout). */
export function resetWorkspaceLayout() {
  const api = getWorkspaceApi();
  if (api) buildDefaultLayout(api);
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

  return (
    <div className="nf-dockview-host">
      <DockviewReact
        theme={themeAbyss}
        components={components}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  );
}
