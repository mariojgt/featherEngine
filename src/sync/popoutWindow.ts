import { isDesktop } from '../platform';

/** Panel ids that can be popped out into their own OS window (the viewport can't — WebGL). */
export const POPPABLE_PANELS: Record<string, string> = {
  hierarchy: 'Hierarchy',
  inspector: 'Inspector',
  project: 'Project',
  scripting: 'Scripting',
  materials: 'Material',
};

const labelFor = (kind: string) => `panel-${kind}`;

/**
 * Open a panel in a real OS window. On desktop uses a Tauri WebviewWindow (which,
 * unlike window.open, isn't blocked by the webview); on web falls back to window.open.
 * Both load `?panel=<kind>` and sync state via BroadcastChannel. Returns false if the
 * window could not be opened (caller keeps the panel docked).
 */
export async function openPanelWindow(kind: string): Promise<boolean> {
  const title = `${POPPABLE_PANELS[kind] ?? kind} — NodeForge`;
  const url = `index.html?panel=${encodeURIComponent(kind)}`;

  if (isDesktop) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = labelFor(kind);
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return true;
      }
      const win = new WebviewWindow(label, { url, title, width: 480, height: 680, resizable: true });
      return await new Promise<boolean>((resolve) => {
        win.once('tauri://created', () => resolve(true));
        win.once('tauri://error', () => resolve(false));
      });
    } catch {
      return false;
    }
  }

  const opened = window.open(url, labelFor(kind), 'width=480,height=680');
  if (opened) {
    opened.focus();
    return true;
  }
  return false;
}
