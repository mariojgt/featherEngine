import type { FeatherPluginDefinition } from './types';
import { arborForgePlugin } from './arborForge';
import { modelForgePlugin } from './modelForge';
import { pixelArtTreesPlugin } from './pixelArtTrees';

/**
 * The plugin GALLERY: store-installable plugins compiled into this build but dormant until the
 * user installs them.
 *
 * This is the deliberate middle ground between "every plugin is always on" (bundledPlugins) and a
 * runtime code loader we don't have: a plugin `.nfpack` in the Asset Store carries no code, only a
 * manifest whose `meta.pluginId` must match an entry here. Installing activates the module and
 * persists the choice (src/store/pluginStore.ts); a manifest naming a module this build doesn't
 * include fails with a clear "needs a newer Feather" message instead of appearing to work.
 */
export const AVAILABLE_PLUGINS: readonly FeatherPluginDefinition[] = [
  arborForgePlugin,
  modelForgePlugin,
  pixelArtTreesPlugin,
];

export const getAvailablePlugin = (pluginId: string): FeatherPluginDefinition | undefined =>
  AVAILABLE_PLUGINS.find((plugin) => plugin.id === pluginId);

export const hasAvailablePlugin = (pluginId: string): boolean => !!getAvailablePlugin(pluginId);
