import { useEffect } from 'react';
import { HierarchyPanel } from './HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { AssetBrowser } from './AssetBrowser';
import { VisualScriptingPanel } from './VisualScriptingPanel';
import { broadcastPanelClosed, initStoreSync } from '../sync/storeSync';

const PANELS: Record<string, () => JSX.Element> = {
  hierarchy: HierarchyPanel,
  inspector: InspectorPanel,
  project: AssetBrowser,
  scripting: VisualScriptingPanel,
};

/**
 * Root of a popped-out panel window (loaded via ?panel=<kind>). Renders just the one
 * panel full-bleed, pulls the current project over BroadcastChannel, and notifies the
 * main window when it closes so the dock can restore the panel.
 */
export function PanelHost({ kind }: { kind: string }) {
  useEffect(() => {
    initStoreSync({ requestSnapshot: true });
    const onUnload = () => broadcastPanelClosed(kind);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [kind]);

  const Panel = PANELS[kind];
  if (!Panel) {
    return <div className="panel-window panel-window-empty">Unknown panel: {kind}</div>;
  }

  return (
    <div className="panel-window">
      <Panel />
    </div>
  );
}
