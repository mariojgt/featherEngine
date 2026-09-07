import { zipSync } from 'fflate';
import { buildPackage, parsePackage } from '../project/package';
import { writePackageArchive } from '../project/packageArchive';
import { PACKAGE_SEMVER, PLUGIN_ID } from '../project/packageValidation';
import { FEATHER_EXTENSION_API_VERSION } from './types';

export interface PluginStarterOptions { id: string; name: string; version: string; description?: string }

/** Pure generator shared by the editor and tests. Produces source plus its install manifest. */
export function createPluginStarter(options: PluginStarterOptions): Uint8Array {
  const id = options.id.trim(), name = options.name.trim(), version = options.version.trim();
  if (!PLUGIN_ID.test(id) || id.length > 120) throw new Error('Use a namespaced id such as studio.inventory-tools (lowercase letters, numbers and hyphens).');
  if (!name || name.length > 160) throw new Error('Enter a plugin name of 1–160 characters.');
  if (!PACKAGE_SEMVER.test(version)) throw new Error('Use a version such as 1.0.0 or 1.0.0-beta.1.');
  const quote = JSON.stringify;
  const source = `import type { FeatherPluginDefinition } from '../types';

const plugin: FeatherPluginDefinition = {
  id: ${quote(id)},
  name: ${quote(name)},
  version: ${quote(version)},
  description: ${quote(options.description?.trim() ?? '')},
  apiVersion: ${quote(FEATHER_EXTENSION_API_VERSION)},
  activate(api) {
    const panelId = api.pluginId + '.panel';
    const placeCube = () => {
      try {
        const objectId = api.objects.create({ kind: 'cube', name: ${quote(name + ' Cube')}, position: [0, 1, 0] });
        api.objects.select(objectId);
        api.ui.notify('Cube added. Undo removes it.');
      } catch (error) {
        api.ui.notify(error instanceof Error ? error.message : 'Could not add a cube.', 'error');
      }
    };
    api.panels.register({
      id: panelId,
      title: ${quote(name)},
      placement: { referencePanel: 'viewport', direction: 'right' },
      render: () => <section style={{ padding: 16 }}>
        <h3>{${quote(name)}}</h3>
        <p>Start by adding an object, then extend this panel with your own tools.</p>
        <button onClick={placeCube}>Add a cube</button>
      </section>,
    });
    api.commands.register({ id: api.pluginId + '.open', title: ${quote('Open ' + name)}, group: 'Plugins', run: () => { api.panels.open(panelId); } });
    // Registrations are disposed automatically. Return cleanup for resources you own:
    // return () => { clearInterval(timer); controller.abort(); };
  },
};
export default plugin;
`;
  const manifest = buildPackage('plugin', { prefabs: [], blueprints: [], graphs: [], materials: [], particleSystems: [], skeletons: [], skeletalMeshes: [], animations: [], animatorControllers: [], dataAssets: [], uiDocuments: [], variables: [] }, [], {
    id, name, version, description: options.description?.trim(), pluginId: id,
  });
  parsePackage(manifest);
  const readme = `${name}\n\n1. Copy src/extensions/userPlugins/${id}.tsx into your Feather engine source checkout. Keep existing files; each plugin needs a unique id.\n2. Restart npm run dev, or run npm run build for a production editor. Modules in this folder are discovered automatically.\n3. Open Asset Store → Create plugin → Local plugins and enable ${name}. Use its Open button to show the starter panel.\n4. In an open project, click Add a cube. Undo should remove it. Disable the plugin and confirm its panel and commands disappear.\n5. Edit the TSX file. Keep activate synchronous. Return a cleanup function for timers, observers and network requests you create. The host owns cleanup of registered commands, panels and events.\n6. Run npm test and npm run build before sharing your editor build. ${id}.nfpack is an activation manifest for builds containing this module; it contains no executable plugin code.\n\nAPI reference: src/extensions/types.ts. Plugins extend the editor; game UI and gameplay belong in project widgets and Blueprints.\n`;
  const encode = (value: string) => new TextEncoder().encode(value);
  return zipSync({ [`src/extensions/userPlugins/${id}.tsx`]: encode(source), [`${id}.nfpack`]: writePackageArchive(manifest, new Map()), 'README.txt': encode(readme) }, { level: 6 });
}
