import type { DockviewApi } from 'dockview-react';

export interface WorkspacePanelDefinition {
  id: string;
  title: string;
  placement?: {
    referencePanel?: string;
    direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  };
}

// Shared handle to the live Dockview api so non-workspace components (e.g. the
// Hierarchy) can reveal a panel without importing Workspace and creating a cycle.
let apiSingleton: DockviewApi | null = null;

/** Where a built-in panel docks when it has to be created on demand. */
export interface DockPanelDef {
  component: string;
  title: string;
  ref?: string;
  direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  /** Preferred share of the workspace height for panels docked above/below the main view. */
  preferredHeightRatio?: number;
}

// Injected by Workspace at module load. Passing the table in (rather than importing it) keeps
// this module free of a dependency cycle back to Workspace.
let panelDefs: Record<string, DockPanelDef> = {};

export function registerPanelDefs(defs: Record<string, DockPanelDef>) {
  panelDefs = defs;
}

/** Add a built-in panel at its usual spot. No-op if it is already docked or unknown. */
export function ensureWorkspacePanel(id: string): boolean {
  const api = apiSingleton;
  if (!api) return false;
  if (api.getPanel(id)) return true;
  const def = panelDefs[id];
  if (!def) return false;
  // Position relative to its usual neighbour, but fall back to a plain add if that's gone.
  const position =
    def.ref && def.direction && api.getPanel(def.ref) ? { referencePanel: def.ref, direction: def.direction } : undefined;
  const panel = api.addPanel({ id, component: def.component, title: def.title, position });
  if (def.preferredHeightRatio && (def.direction === 'above' || def.direction === 'below')) {
    const availableHeight = api.height || (typeof window === 'undefined' ? 720 : window.innerHeight);
    panel.api.setSize({ height: Math.max(360, Math.round(availableHeight * def.preferredHeightRatio)) });
  }
  return true;
}

export function setWorkspaceApi(api: DockviewApi | null) {
  apiSingleton = api;
}

export function getWorkspaceApi(): DockviewApi | null {
  return apiSingleton;
}

/**
 * Reveal a panel (by id, e.g. 'scripting'): dock it if it isn't open, then bring it to the front.
 *
 * Every caller means "show me this" — "Edit this material", double-clicking an object to script
 * it, and so on. Since the default shell only docks the viewport, the sidebar and the Inspector,
 * a focus-only version of this would silently do nothing for most panels.
 */
export function focusWorkspacePanel(id: string) {
  ensureWorkspacePanel(id);
  apiSingleton?.getPanel(id)?.api.setActive();
}

/** Whether the Dockview group containing a panel currently owns the workspace. */
export function isWorkspacePanelMaximized(id: string): boolean {
  return apiSingleton?.getPanel(id)?.api.isMaximized() ?? false;
}

/** Toggle a panel's native Dockview focus mode without rebuilding or losing the user's layout. */
export function toggleWorkspacePanelMaximized(id: string): boolean {
  if (!ensureWorkspacePanel(id)) return false;
  const panel = apiSingleton?.getPanel(id);
  if (!panel) return false;
  if (panel.api.isMaximized()) panel.api.exitMaximized();
  else panel.api.maximize();
  return panel.api.isMaximized();
}

/** Subscribe to focus-mode changes for one panel. */
export function onWorkspacePanelMaximizedChange(id: string, listener: (maximized: boolean) => void): () => void {
  const api = apiSingleton;
  listener(isWorkspacePanelMaximized(id));
  if (!api) return () => undefined;
  const disposable = api.onDidMaximizedGroupChange(() => listener(isWorkspacePanelMaximized(id)));
  return () => disposable.dispose();
}

/** Open an extension panel, adding it to Dockview the first time and focusing it thereafter. */
export function openWorkspacePanel(definition: WorkspacePanelDefinition): boolean {
  const api = apiSingleton;
  if (!api) return false;
  const existing = api.getPanel(definition.id);
  if (existing) {
    existing.api.setActive();
    return true;
  }

  const referencePanel = definition.placement?.referencePanel ?? 'viewport';
  const direction = definition.placement?.direction ?? 'right';
  const position = api.getPanel(referencePanel) ? { referencePanel, direction } : undefined;
  api.addPanel({
    id: definition.id,
    component: definition.id,
    title: definition.title,
    position,
  });
  api.getPanel(definition.id)?.api.setActive();
  return true;
}

/** Remove a dynamically registered panel if it is currently open. */
export function closeWorkspacePanel(id: string): void {
  apiSingleton?.getPanel(id)?.api.close();
}

/**
 * Give the viewport its native Dockview focus mode.
 *
 * This intentionally uses the group maximize API instead of clearing/recreating
 * the dock. Existing panels therefore stay mounted, retain their local state, and
 * the user's underlying split sizes remain untouched.
 */
export function maximizeViewportLayout(): boolean {
  if (!ensureWorkspacePanel('viewport')) return false;
  const panel = apiSingleton?.getPanel('viewport');
  if (!panel) return false;
  panel.api.setActive();
  panel.api.maximize();
  return panel.api.isMaximized();
}

/** Exit native focus mode without rebuilding the dock or replacing any panels. */
export function restoreWorkspaceLayout(): boolean {
  const api = apiSingleton;
  if (!api) return false;
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
  ensureWorkspacePanel('viewport');
  return true;
}

export function isViewportLayoutMaximized(): boolean {
  return isWorkspacePanelMaximized('viewport');
}
