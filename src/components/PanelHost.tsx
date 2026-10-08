import { useEffect } from 'react';
import { BuiltInPanel, isBuiltInPanel } from './builtInPanels';
import { broadcastPanelClosed, initStoreSync } from '../sync/storeSync';
import { useExtensionSnapshot } from '../extensions/react';
import { ExtensionPanelBoundary } from '../extensions/ExtensionPanelBoundary';


/**
 * Root of a popped-out panel window (loaded via ?panel=<kind>). Renders just the one
 * panel full-bleed, pulls the current project over BroadcastChannel, and notifies the
 * main window when it closes so the dock can restore the panel.
 */
export function PanelHost({ kind }: { kind: string }) {
  const extensionPanel = useExtensionSnapshot().panels.find((panel) => panel.id === kind);
  useEffect(() => {
    initStoreSync({ requestSnapshot: true });
    const onUnload = () => broadcastPanelClosed(kind);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [kind]);

  const builtIn = isBuiltInPanel(kind);
  if (!builtIn && !extensionPanel) {
    return <div className="panel-window panel-window-empty">Unknown panel: {kind}</div>;
  }

  return (
    <div className="panel-window">
      {isBuiltInPanel(kind) ? (
        <BuiltInPanel kind={kind} />
      ) : extensionPanel ? (
        <ExtensionPanelBoundary
          pluginId={extensionPanel.pluginId}
          panelId={extensionPanel.id}
          title={extensionPanel.title}
          render={extensionPanel.render}
        />
      ) : null}
    </div>
  );
}
