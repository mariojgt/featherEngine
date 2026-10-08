import { lazy, Suspense } from 'react';
import { defineFeatherPlugin } from './types';

const PLUGIN_ID = 'feather.model-forge';
const PANEL_ID = `${PLUGIN_ID}.studio`;
const ModelForgePanel = lazy(() => import('./ModelForgePanel').then(module => ({ default: module.ModelForgePanel })));

export const modelForgePlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Model Forge',
  version: '1.2.0',
  description:
    'A Blender-style in-engine modeler: polygon Edit mode (extrude, inset, bevel, loop cut, G/R/S with axis locks, proportional editing, X-mirror), non-destructive mirror/array/subdivision modifiers, lathe and tube generators, UV unwrapping, project materials, GLB import and baking.',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Model Forge',
      // A library + 3D gizmo canvas + part inspector needs Tree-Builder width, so it docks below the viewport.
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <Suspense fallback={<div className="empty-state" role="status">Loading Model Forge…</div>}><ModelForgePanel api={api} /></Suspense>,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open`,
      title: 'Open Model Forge (prototype modeler)',
      group: 'Extensions',
      keywords: 'model prop prototype blockout kitbash paint fence crate mesh',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PLUGIN_ID}.new-prop`,
      title: 'New prototype prop (Model Forge)',
      group: 'Extensions',
      keywords: 'model prop new crate starter',
      run: () => {
        api.models.createFromStarter('crate');
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
