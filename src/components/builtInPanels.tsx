import { lazy, Suspense } from 'react';

// Share the same deferred components between the dock and pop-out windows. Keeping either
// host's imports eager would pull every editor back into the startup bundle.
const panels = {
  agent: lazy(() => import('./AIChatWidget').then(module => ({ default: module.AgentPanel }))),
  hierarchy: lazy(() => import('./HierarchyPanel').then(module => ({ default: module.HierarchyPanel }))),
  viewport: lazy(() => import('./Viewport').then(module => ({ default: module.ViewportPanel }))),
  inspector: lazy(() => import('./InspectorPanel').then(module => ({ default: module.InspectorPanel }))),
  project: lazy(() => import('./AssetBrowser').then(module => ({ default: module.AssetBrowser }))),
  scripting: lazy(() => import('./VisualScriptingPanel').then(module => ({ default: module.VisualScriptingPanel }))),
  materials: lazy(() => import('./MaterialEditorPanel').then(module => ({ default: module.MaterialEditorPanel }))),
  terrain: lazy(() => import('./TerrainEditorPanel').then(module => ({ default: module.TerrainEditorPanel }))),
  trees: lazy(() => import('./TreeBuilderPanel').then(module => ({ default: module.TreeBuilderPanel }))),
  store: lazy(() => import('./AssetStorePanel').then(module => ({ default: module.AssetStorePanel }))),
  particles: lazy(() => import('./ParticleSystemEditorPanel').then(module => ({ default: module.ParticleSystemEditorPanel }))),
  animator: lazy(() => import('./AnimatorEditorPanel').then(module => ({ default: module.AnimatorEditorPanel }))),
  ui: lazy(() => import('./UIEditorPanel').then(module => ({ default: module.UIEditorPanel }))),
  scene: lazy(() => import('./SceneSettingsPanel').then(module => ({ default: module.SceneSettingsPanel }))),
  cinematic: lazy(() => import('./CinematicPanel').then(module => ({ default: module.CinematicPanel }))),
};

export type BuiltInPanelId = keyof typeof panels;
export const BUILT_IN_PANEL_IDS = Object.keys(panels) as BuiltInPanelId[];
export const isBuiltInPanel = (id: string): id is BuiltInPanelId => Object.prototype.hasOwnProperty.call(panels, id);

export function BuiltInPanel({ kind }: { kind: BuiltInPanelId }) {
  const Panel = panels[kind];
  return (
    <Suspense fallback={<div className="empty-state" role="status">Loading panel…</div>}>
      <Panel />
    </Suspense>
  );
}
