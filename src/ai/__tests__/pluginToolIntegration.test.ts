import { describe, expect, it } from 'vitest';
import { activateExtensionPlugin, extensionRegistry } from '../../extensions/host';
import { getActiveEngineTools } from '../tools';

describe('plugin AI tools in the assistant surface', () => {
  it('merges registered plugin tools into the live engine-tool surface, keyed pluginId.toolId', () => {
    const pluginId = 'test.ai-tool';
    const deactivate = activateExtensionPlugin({
      id: pluginId,
      name: 'AI Tool Test',
      version: '1.0.0',
      activate(api) {
        api.tools.register({
          id: 'build-vase',
          title: 'Build vase',
          description: 'Build a vase model asset.',
          inputSchema: { type: 'object' },
          execute: () => 'built vase',
        });
      },
    });

    try {
      const active = getActiveEngineTools();
      const qualified = `${pluginId}.build-vase`;
      expect(Object.prototype.hasOwnProperty.call(active, qualified)).toBe(true);
      const def = active[qualified as keyof typeof active] as { description?: string; execute?: (value: unknown) => unknown };
      expect(def.description).toContain('vase');
      expect(def.execute).toBeTypeOf('function');
      // The built-in set is still intact alongside it.
      expect(Object.prototype.hasOwnProperty.call(active, 'list_scene')).toBe(true);
    } finally {
      deactivate();
    }

    // Disabling removes the plugin tool again.
    expect(Object.prototype.hasOwnProperty.call(getActiveEngineTools(), `${pluginId}.build-vase`)).toBe(false);
    expect(extensionRegistry.hasPlugin(pluginId)).toBe(false);
  });
});