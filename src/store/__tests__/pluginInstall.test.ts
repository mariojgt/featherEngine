import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionRegistry } from '../../extensions/host';
import { AVAILABLE_PLUGINS } from '../../extensions/availablePlugins';
import { PIXEL_ART_TREES_PLUGIN_ID } from '../../extensions/pixelArtTrees';
import { useMarketplaceStore } from '../marketplaceStore';
import { MODEL_FORGE_PLUGIN_ID, usePluginStore } from '../pluginStore';
import { useProjectStore } from '../projectStore';

/**
 * The store plugin path end-to-end against the REAL shipped catalog: the Arbor Forge listing's
 * `.nfpack` manifest names a compiled-in module, installing activates it, removing deactivates it,
 * and boot-time restore brings the persisted set back.
 */

const PUBLIC_STORE = join(process.cwd(), 'public', 'store');

function serveBundledStore() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input), document.baseURI).pathname;
      const relative = path.slice(path.indexOf('/store/') + '/store/'.length);
      try {
        const body = await readFile(join(PUBLIC_STORE, relative));
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => JSON.parse(body.toString('utf8')),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      } catch {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      }
    }),
  );
}

const ARBOR_ID = 'feather.arbor-forge';

describe('store plugin install', () => {
  beforeEach(() => {
    useProjectStore.setState({ toast: null, error: null });
    useMarketplaceStore.setState({ status: 'idle', error: null, packages: [], query: '', tag: null, installingId: null, installedIds: [] });
    usePluginStore.setState({ enabledIds: [], coreBootstrapped: true });
    serveBundledStore();
  });

  afterEach(() => {
    // The registry is module-global; leave no plugin active for the next test file.
    for (const plugin of AVAILABLE_PLUGINS) extensionRegistry.deactivatePlugin(plugin.id);
    vi.unstubAllGlobals();
  });

  it('ships Arbor Forge in the catalog as an installable plugin of this build', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages.find((entry) => entry.kind === 'plugin');
    expect(listing).toBeDefined();
    expect(listing!.pluginId).toBe(ARBOR_ID);
    // The catalog must only advertise modules this build actually compiles in.
    expect(AVAILABLE_PLUGINS.some((plugin) => plugin.id === listing!.pluginId)).toBe(true);
  });

  it('ships and activates Pixel Art Trees as its own removable store plugin', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages.find(
      (entry) => entry.pluginId === PIXEL_ART_TREES_PLUGIN_ID,
    );
    expect(listing?.kind).toBe('plugin');
    expect(AVAILABLE_PLUGINS.some((plugin) => plugin.id === PIXEL_ART_TREES_PLUGIN_ID)).toBe(true);

    await useMarketplaceStore.getState().install(listing!);
    expect(extensionRegistry.hasPlugin(PIXEL_ART_TREES_PLUGIN_ID)).toBe(true);
    expect(extensionRegistry.getSnapshot().panels.some((panel) => panel.pluginId === PIXEL_ART_TREES_PLUGIN_ID)).toBe(true);
    expect(usePluginStore.getState().disable(PIXEL_ART_TREES_PLUGIN_ID)).toBe(true);
    expect(extensionRegistry.hasPlugin(PIXEL_ART_TREES_PLUGIN_ID)).toBe(false);
  });

  it('installs from the store WITHOUT an open project and activates the module', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages.find((entry) => entry.kind === 'plugin')!;

    expect(useProjectStore.getState().hasProject).toBe(false);
    await useMarketplaceStore.getState().install(listing);

    expect(extensionRegistry.hasPlugin(ARBOR_ID)).toBe(true);
    expect(usePluginStore.getState().enabledIds).toContain(ARBOR_ID);
    expect(useMarketplaceStore.getState().installedIds).toContain(listing.id);
    expect(useProjectStore.getState().toast?.kind).toBe('success');

    // The plugin's contributions are real: its panel and commands are registered.
    const snapshot = extensionRegistry.getSnapshot();
    expect(snapshot.panels.some((panel) => panel.pluginId === ARBOR_ID)).toBe(true);
    expect(snapshot.commands.filter((command) => command.pluginId === ARBOR_ID).length).toBeGreaterThanOrEqual(2);
  });

  it('remove deactivates immediately and forgets the persisted id', async () => {
    expect(usePluginStore.getState().enable(ARBOR_ID)).toBeNull();
    expect(extensionRegistry.hasPlugin(ARBOR_ID)).toBe(true);

    expect(usePluginStore.getState().disable(ARBOR_ID)).toBe(true);
    expect(extensionRegistry.hasPlugin(ARBOR_ID)).toBe(false);
    expect(usePluginStore.getState().enabledIds).not.toContain(ARBOR_ID);
    expect(extensionRegistry.getSnapshot().commands.some((command) => command.pluginId === ARBOR_ID)).toBe(false);
  });

  it('refuses a module this build does not include, with a readable message', () => {
    const failure = usePluginStore.getState().enable('feather.not-in-this-build');
    expect(failure).toMatch(/newer engine release/);
    expect(usePluginStore.getState().enabledIds).toHaveLength(0);
  });

  it('restore() re-activates the persisted set at boot', () => {
    usePluginStore.setState({ enabledIds: [ARBOR_ID, 'feather.from-the-future'] });
    usePluginStore.getState().restore();
    expect(extensionRegistry.hasPlugin(ARBOR_ID)).toBe(true);
    // The unknown id survives (a newer build may include it) without breaking the restore.
    expect(usePluginStore.getState().enabledIds).toContain('feather.from-the-future');
  });

  it('first restore auto-enables Model Forge for new users', () => {
    usePluginStore.setState({ enabledIds: [], coreBootstrapped: false });
    usePluginStore.getState().restore();
    expect(usePluginStore.getState().coreBootstrapped).toBe(true);
    expect(usePluginStore.getState().enabledIds).toContain(MODEL_FORGE_PLUGIN_ID);
    expect(extensionRegistry.hasPlugin(MODEL_FORGE_PLUGIN_ID)).toBe(true);
  });
});
