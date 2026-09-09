import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import { PanelHost } from './components/PanelHost';
import { initStoreSync } from './sync/storeSync';
import { startMcpBridge } from './ai/mcpBridge';
import { startExtensionHost } from './extensions/host';
import { useEditorStore } from './store/editorStore';
import { useProjectStore } from './store/projectStore';
import { usePluginStore } from './store/pluginStore';
import './styles.css';
import './editor-ui.css';
import '@xyflow/react/dist/style.css';

// DEV-only handle for the end-to-end suite (scripts/e2e), which drives real Chrome over CDP and
// needs to set up scenarios the UI can't reach in a few clicks. Never present in a production build.
if (import.meta.env.DEV) {
  (window as unknown as { __featherProject: unknown }).__featherProject = new Proxy({}, { get: (_, key: string) => useProjectStore.getState()[key as keyof ReturnType<typeof useProjectStore.getState>] });
  (window as unknown as { __featherStore: unknown }).__featherStore = new Proxy(
    {},
    { get: (_, key: string) => useEditorStore.getState()[key as keyof ReturnType<typeof useEditorStore.getState>] },
  );
}

// A `?panel=<kind>` URL means this window is a popped-out panel — render just that
// panel and pull state from the main window. Otherwise render the full editor.
const panelKind = new URLSearchParams(window.location.search).get('panel');

// Register bundled extensions before React mounts so saved layouts can resolve their panels,
// then re-activate whatever store plugins this user has installed (same reason, same timing).
startExtensionHost();
usePluginStore.getState().restore();

if (!panelKind) {
  // Main editor window: keep sync alive so popped-out panels stay in lockstep.
  initStoreSync({ requestSnapshot: false });
  // Expose engine tools to external MCP agents when the local relay (npm run mcp) is up.
  startMcpBridge();
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReactFlowProvider>{panelKind ? <PanelHost kind={panelKind} /> : <App />}</ReactFlowProvider>
  </React.StrictMode>,
);
