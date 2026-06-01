import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { isDesktop } from '../platform';

/**
 * Cross-window state sync for popped-out panels (see Workspace popout / PanelHost).
 *
 * Separate OS windows are isolated JS contexts, so the Zustand stores don't share
 * memory. We mirror them: every data change is broadcast (throttled), other windows
 * apply it, and edits flow both ways. A freshly opened panel window asks for a
 * snapshot on join. Single-user, last-writer-wins — fine for one person editing one
 * window at a time.
 *
 * Transport differs by platform because BroadcastChannel does NOT reliably cross
 * Tauri's separate WebViews — so on desktop we use Tauri's own global event bus
 * (emit/listen through the Rust core), and on web we use BroadcastChannel.
 *
 * Only data fields cross the wire (functions can't be serialized anyway), so action
 * functions and selectors stay intact on the receiving store via a merge (replace=false).
 */
const CHANNEL = 'nodeforge-sync';

type SyncBody =
  | { type: 'request' }
  | { type: 'state'; editor: Record<string, unknown>; project: Record<string, unknown> }
  | { type: 'panel-closed'; kind: string };
type SyncMessage = SyncBody & { src: string };

// Unique per window so we can ignore our own messages (Tauri's emit echoes to sender).
const srcId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w${performance.now()}`;

/** Strip function-valued (action/selector) fields — keep only serializable data. */
function dataOf(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in state) {
    if (typeof state[key] === 'function') continue;
    out[key] = state[key];
  }
  return out;
}

let initialized = false;
let applying = false; // true while applying a remote snapshot — suppresses re-broadcast
let timer: ReturnType<typeof setTimeout> | null = null;
let rawPost: (msg: SyncMessage) => void = () => {};
const panelClosedHandlers = new Set<(kind: string) => void>();

function post(body: SyncBody) {
  rawPost({ ...body, src: srcId });
}

function flush() {
  timer = null;
  // Don't broadcast an empty (unloaded) store over a real one in another window.
  if (!useProjectStore.getState().hasProject) return;
  try {
    post({
      type: 'state',
      editor: dataOf(useEditorStore.getState() as unknown as Record<string, unknown>),
      project: dataOf(useProjectStore.getState() as unknown as Record<string, unknown>),
    });
  } catch {
    // A field wasn't serializable this tick — skip rather than crash.
  }
}

function scheduleBroadcast() {
  if (applying || timer) return;
  timer = setTimeout(flush, 60);
}

function handleMessage(msg: SyncMessage | undefined | null) {
  if (!msg || msg.src === srcId) return; // ignore malformed and our own echoes
  if (msg.type === 'request') {
    // A window joined — hand it our state if we actually have a project loaded.
    if (useProjectStore.getState().hasProject) flush();
  } else if (msg.type === 'state') {
    // Drop any pending local broadcast so the just-applied state isn't echoed back.
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    applying = true;
    try {
      useEditorStore.setState(msg.editor as never, false);
      useProjectStore.setState(msg.project as never, false);
    } finally {
      applying = false;
    }
  } else if (msg.type === 'panel-closed') {
    panelClosedHandlers.forEach((handler) => handler(msg.kind));
  }
}

/** Wire the platform transport; resolves once messages can be posted. */
async function setupTransport(): Promise<void> {
  if (isDesktop) {
    const { emit, listen } = await import('@tauri-apps/api/event');
    await listen<SyncMessage>(CHANNEL, (event) => handleMessage(event.payload));
    rawPost = (msg) => {
      void emit(CHANNEL, msg);
    };
  } else if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<SyncMessage>) => handleMessage(event.data);
    rawPost = (msg) => channel.postMessage(msg);
  }
}

/**
 * Initialise sync for this window. `requestSnapshot` should be true for popped-out
 * panel windows so they pull the current project from the main window on open.
 */
export function initStoreSync(opts: { requestSnapshot: boolean }) {
  if (initialized) return;
  initialized = true;

  useEditorStore.subscribe(scheduleBroadcast);
  useProjectStore.subscribe(scheduleBroadcast);

  void setupTransport().then(() => {
    if (opts.requestSnapshot) post({ type: 'request' });
  });
}

/** Tell other windows a popped-out panel window is closing (so the dock can restore it). */
export function broadcastPanelClosed(kind: string) {
  post({ type: 'panel-closed', kind });
}

/** Subscribe to popped-out panels closing (used by the dock to re-add the panel). */
export function onPanelClosed(handler: (kind: string) => void): () => void {
  panelClosedHandlers.add(handler);
  return () => panelClosedHandlers.delete(handler);
}
