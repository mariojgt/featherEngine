import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { createFeatherPluginAPI } from './api';
import { bundledPlugins } from './bundledPlugins';
import { FeatherEventBus } from './events';
import { ExtensionRegistry } from './registry';
import {
  FEATHER_EXTENSION_API_VERSION,
  type FeatherDispose,
  type FeatherPluginDefinition,
} from './types';

export const extensionRegistry = new ExtensionRegistry();
export const extensionEventBus = new FeatherEventBus();

export interface ExtensionActivationEnvironment {
  registry: ExtensionRegistry;
  eventBus: FeatherEventBus;
}

/** Activate one trusted plugin and guarantee that every registration is removed on deactivation. */
export function activateExtensionPlugin(
  plugin: FeatherPluginDefinition,
  environment: ExtensionActivationEnvironment = {
    registry: extensionRegistry,
    eventBus: extensionEventBus,
  },
): FeatherDispose {
  if (!plugin.id.trim() || /\s/.test(plugin.id)) throw new Error('Plugin ids must be non-empty and contain no whitespace.');
  if (!plugin.name.trim() || !plugin.version.trim()) throw new Error(`Plugin ${plugin.id} requires a name and version.`);
  if (plugin.apiVersion && plugin.apiVersion !== FEATHER_EXTENSION_API_VERSION) {
    throw new Error(
      `Plugin ${plugin.id} requires Feather Extension API ${plugin.apiVersion}; this engine provides ${FEATHER_EXTENSION_API_VERSION}.`,
    );
  }
  if (environment.registry.hasPlugin(plugin.id)) throw new Error(`Extension plugin id already active: ${plugin.id}`);

  let alive = true;
  const registrations: FeatherDispose[] = [];
  const track = (dispose: FeatherDispose) => {
    registrations.push(dispose);
    return dispose;
  };
  const capabilities = createFeatherPluginAPI(plugin.id, environment.registry, environment.eventBus, track);
  // Copy before wrapping: capability groups are frozen and cannot be wrapped with a get Proxy.
  const api = Object.freeze(Object.fromEntries(Object.entries(capabilities).map(([key, value]) => [key,
    value && typeof value === 'object' && key !== 'log'
      ? Object.freeze(Object.fromEntries(Object.entries(value).map(([method, fn]) => [method, typeof fn === 'function'
        ? (...args: unknown[]) => { if (!alive) throw new Error(`Plugin ${plugin.id} is no longer active.`); return fn(...args); }
        : fn]))) : value,
  ]))) as unknown as typeof capabilities;
  let pluginCleanup: FeatherDispose | undefined;

  const cleanup = () => {
    alive = false;
    try {
      pluginCleanup?.();
    } catch (error) {
      console.error(`[Feather plugin: ${plugin.id}] Deactivation failed`, error);
    }
    for (const dispose of registrations.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[Feather plugin: ${plugin.id}] Registration cleanup failed`, error);
      }
    }
  };

  try {
    const result = plugin.activate(api);
    if (result !== undefined && typeof result !== 'function') {
      // Consume a mistakenly returned Promise, including a possible late cleanup function.
      Promise.resolve(result).then((dispose) => { if (typeof dispose === 'function') (dispose as FeatherDispose)(); }).catch((error) => console.error(`[Feather plugin: ${plugin.id}] Async activation failed`, error));
      throw new Error('Plugin activation must be synchronous and return only a cleanup function or nothing.');
    }
    pluginCleanup = typeof result === 'function' ? result : undefined;
    environment.registry.registerPlugin(plugin, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }

  return () => {
    if (!alive) return;
    environment.registry.deactivatePlugin(plugin.id);
  };
}

let started = false;
const hostDisposers: FeatherDispose[] = [];

/** Start bundled plugins and bridge stable editor state changes into the public event bus. */
export function startExtensionHost(): void {
  if (started) return;
  started = true;

  hostDisposers.push(
    useProjectStore.subscribe((state, previous) => {
      if (state.hasProject === previous.hasProject && state.projectName === previous.projectName) return;
      extensionEventBus.emit('project:changed', { hasProject: state.hasProject, name: state.projectName });
    }),
    useEditorStore.subscribe((state, previous) => {
      if (state.selectedObjectId !== previous.selectedObjectId) {
        extensionEventBus.emit('selection:changed', { objectId: state.selectedObjectId });
      }
      if (state.isPlaying !== previous.isPlaying) {
        extensionEventBus.emit('runtime:play-changed', { isPlaying: state.isPlaying });
      }
      if (state.scenes !== previous.scenes && !state.isPlaying && !previous.isPlaying) {
        extensionEventBus.emit('scene:changed', {
          activeSceneId: state.activeSceneId,
          objectCount: selectActiveObjects(state).length,
        });
      }
      if (state.modelSpecs !== previous.modelSpecs) {
        extensionEventBus.emit('models:changed', { specCount: state.modelSpecs.length });
      }
    }),
  );

  for (const plugin of bundledPlugins) {
    try {
      activateExtensionPlugin(plugin);
    } catch (error) {
      console.error(`[Feather extensions] Could not activate ${plugin.id}`, error);
    }
  }
}

/** Primarily useful for tests and future hot-reload support. */
export function stopExtensionHost(): void {
  if (!started) return;
  extensionRegistry.deactivateAll();
  for (const dispose of hostDisposers.splice(0).reverse()) dispose();
  started = false;
}
