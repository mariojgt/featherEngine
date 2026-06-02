/**
 * Editable UI layer: renders a UI document (via UIElementView) and overlays direct-manipulation
 * affordances on the selected element — click to select, drag the body to move, drag a handle to
 * resize. Used both on the 3D viewport (screen HUDs) and inside the UI panel (world widgets).
 *
 * Selection is shared via the store (`selectedUIElementId`) so the panel tree and this layer stay
 * in sync. All edits commit through `updateUIElement(style)` — the same model the runtime + AI use.
 *
 * Gesture model (fixes the earlier broken drag): handles/box stop propagation so selecting never
 * steals the gesture; move/resize listen on `window` (so it keeps tracking off-element) and commit
 * coalesced via requestAnimationFrame.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { UIDocument, UIElement, UIStyle } from '../types';
import { buildUIContext } from './runtimeContext';
import { UIElementView } from './UIElementView';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The root rendered to fill the editing frame (so a screen doc's children place like on-screen). */
function rootFill(doc: UIDocument): UIElement {
  return {
    ...doc.root,
    style: { width: '100%', height: '100%', position: 'relative', ...doc.root.style },
  };
}

function findEl(root: UIElement, id: string): UIElement | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findEl(c, id);
    if (f) return f;
  }
  return undefined;
}

export function UIEditLayer({ doc, fillParent }: { doc: UIDocument; fillParent?: boolean }) {
  const variables = useEditorStore((state) => state.variables);
  const assets = useEditorStore((state) => state.assets);
  const updateUIElement = useEditorStore((state) => state.updateUIElement);
  const selectedId = useEditorStore((state) => state.selectedUIElementId);
  const selectUIElement = useEditorStore((state) => state.selectUIElement);

  const frameRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<Rect | null>(null);
  // Active gesture; rAF id for coalescing; pending style to flush.
  const gesture = useRef<{ mode: 'move' | Handle; startX: number; startY: number; base: Rect; id: string } | null>(null);
  const raf = useRef<number | null>(null);
  const pending = useRef<UIStyle | null>(null);

  const ctx = buildUIContext({ variables, runtimeVariableValues: {}, runtimeObjectVariables: {}, isPlaying: false });
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;
  const selected = selectedId ? findEl(doc.root, selectedId) : undefined;
  const canEdit = selected && selected.id !== doc.root.id;

  // Glue the selection overlay to the selected element after each render (incl. mid-drag).
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const node = selectedId ? frame?.querySelector<HTMLElement>(`[data-uiel-id="${selectedId}"]`) : null;
    if (!frame || !node || !canEdit) {
      if (overlay) setOverlay(null);
      return;
    }
    const f = frame.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const next: Rect = { left: r.left - f.left, top: r.top - f.top, width: r.width, height: r.height };
    if (!overlay || overlay.left !== next.left || overlay.top !== next.top || overlay.width !== next.width || overlay.height !== next.height) {
      setOverlay(next);
    }
  });

  /** Measure the selected node's box relative to its offsetParent (basis for absolute left/top). */
  const measureBase = (): Rect | null => {
    const frame = frameRef.current;
    const node = frame?.querySelector<HTMLElement>(`[data-uiel-id="${selectedId}"]`);
    if (!node) return null;
    const parent = (node.offsetParent as HTMLElement | null) ?? frame!;
    const pr = parent.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { left: r.left - pr.left, top: r.top - pr.top, width: r.width, height: r.height };
  };

  const flush = () => {
    raf.current = null;
    const g = gesture.current;
    if (g && pending.current) updateUIElement(doc.id, g.id, { style: pending.current });
  };

  const onWindowMove = (event: PointerEvent) => {
    const g = gesture.current;
    if (!g || !selected) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    let { left, top, width, height } = g.base;
    if (g.mode === 'move') {
      left += dx;
      top += dy;
    } else {
      if (g.mode.includes('e')) width = Math.max(8, g.base.width + dx);
      if (g.mode.includes('s')) height = Math.max(8, g.base.height + dy);
      if (g.mode.includes('w')) { width = Math.max(8, g.base.width - dx); left = g.base.left + dx; }
      if (g.mode.includes('n')) { height = Math.max(8, g.base.height - dy); top = g.base.top + dy; }
    }
    pending.current = {
      ...selected.style,
      position: 'absolute',
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      height: `${Math.round(height)}px`,
    };
    if (raf.current == null) raf.current = requestAnimationFrame(flush);
  };

  const endGesture = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (gesture.current && pending.current) updateUIElement(doc.id, gesture.current.id, { style: pending.current });
    pending.current = null;
    gesture.current = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', endGesture);
  };

  const beginGesture = (mode: 'move' | Handle, event: React.PointerEvent) => {
    if (!selected || !canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const base = measureBase();
    if (!base) return;
    // Bake current layout into absolute so deltas are coherent.
    updateUIElement(doc.id, selected.id, {
      style: {
        ...selected.style,
        position: 'absolute',
        left: `${Math.round(base.left)}px`,
        top: `${Math.round(base.top)}px`,
        width: `${Math.round(base.width)}px`,
        height: `${Math.round(base.height)}px`,
      },
    });
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, base, id: selected.id };
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', endGesture);
  };

  return (
    <div
      className="ui-edit-layer"
      ref={frameRef}
      onPointerDown={(event) => {
        // Bubble-phase: handles/box already stopped propagation, so this only fires for content.
        const target = (event.target as HTMLElement).closest('[data-uiel-id]') as HTMLElement | null;
        selectUIElement(target?.getAttribute('data-uiel-id') ?? doc.root.id);
      }}
      onClickCapture={(event) => {
        // Don't let preview buttons activate while editing.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <UIElementView
        element={fillParent ? rootFill(doc) : doc.root}
        ctx={ctx}
        resolveAssetUrl={resolveAssetUrl}
        editable
      />

      {overlay && canEdit && (
        <div
          className="ui-select-box"
          style={{ left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height }}
          onPointerDown={(event) => beginGesture('move', event)}
        >
          {HANDLES.map((handle) => (
            <span key={handle} className={`ui-resize-handle h-${handle}`} onPointerDown={(event) => beginGesture(handle, event)} />
          ))}
        </div>
      )}
    </div>
  );
}
