import { useState } from 'react';
import { createPluginStarter } from '../extensions/pluginStarter';
import { AVAILABLE_PLUGINS } from '../extensions/availablePlugins';
import { extensionRegistry } from '../extensions/host';
import { usePluginStore } from '../store/pluginStore';
import { getPlatform } from '../platform';
import { openWorkspacePanel } from './workspacePanels';

export function PluginCreator() {
  const [id, setId] = useState('studio.my-tools');
  const [name, setName] = useState('My Tools');
  const [version, setVersion] = useState('1.0.0');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = usePluginStore((state) => state.enabledIds);
  const enable = usePluginStore((state) => state.enable);
  const disable = usePluginStore((state) => state.disable);
  const create = async () => {
    setBusy(true); setMessage('');
    try {
      if (AVAILABLE_PLUGINS.some((plugin) => plugin.id === id.trim())) throw new Error('That plugin id already exists in this build. Choose a unique id.');
      const bytes = createPluginStarter({ id, name, version });
      const destination = await (await getPlatform()).saveBinary(`${id.trim()}-starter.zip`, bytes, { title: 'Save plugin starter', mimeType: 'application/zip', filters: [{ name: 'Plugin starter ZIP', extensions: ['zip'] }] });
      if (destination) setMessage('Starter saved. Its README walks through adding the source, building, and enabling your plugin.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create plugin starter.'); }
    finally { setBusy(false); }
  };
  return <details className="plugin-creator">
    <summary>Create plugin</summary>
    <p>Create a working editor panel and command. Add the generated source to your Feather checkout, rebuild, then enable it below.</p>
    <div className="plugin-creator-fields">
      <label className="node-field"><span>Plugin id</span><input aria-label="Plugin id" value={id} onChange={(event) => setId(event.target.value)} /></label>
      <label className="node-field"><span>Name</span><input aria-label="Plugin name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="node-field"><span>Version</span><input aria-label="Plugin version" value={version} onChange={(event) => setVersion(event.target.value)} /></label>
    </div>
    <button className="full-button" disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Download plugin starter'}</button>
    {message && <p role="status">{message}</p>}
    <h4>Local plugins</h4>
    <p>Modules available in this editor build.</p>
    {AVAILABLE_PLUGINS.map((plugin) => <div className="plugin-local-row" key={plugin.id}>
      <span>{plugin.name} <small>v{plugin.version}</small></span>
      <button onClick={() => { if (enabled.includes(plugin.id)) disable(plugin.id); else { const error = enable(plugin.id); if (error) setMessage(error); } }}>{enabled.includes(plugin.id) ? 'Disable' : 'Enable'}</button>
      {enabled.includes(plugin.id) && <button onClick={() => { const panel = extensionRegistry.getSnapshot().panels.find((item) => item.pluginId === plugin.id); if (panel) openWorkspacePanel(panel); else setMessage('This plugin provides commands. Find them in the command palette.'); }}>Open</button>}
    </div>)}
  </details>;
}
