import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import { PanelHost } from './components/PanelHost';
import { initStoreSync } from './sync/storeSync';
import { startMcpBridge } from './ai/mcpBridge';
import './styles.css';
import '@xyflow/react/dist/style.css';

// A `?panel=<kind>` URL means this window is a popped-out panel — render just that
// panel and pull state from the main window. Otherwise render the full editor.
const panelKind = new URLSearchParams(window.location.search).get('panel');

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
