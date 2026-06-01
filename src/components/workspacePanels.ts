import type { DockviewApi } from 'dockview-react';

// Shared handle to the live Dockview api so non-workspace components (e.g. the
// Hierarchy) can reveal a panel without importing Workspace and creating a cycle.
let apiSingleton: DockviewApi | null = null;

export function setWorkspaceApi(api: DockviewApi | null) {
  apiSingleton = api;
}

export function getWorkspaceApi(): DockviewApi | null {
  return apiSingleton;
}

/** Bring a panel (by id, e.g. 'scripting') to the front and focus its group. */
export function focusWorkspacePanel(id: string) {
  apiSingleton?.getPanel(id)?.api.setActive();
}
