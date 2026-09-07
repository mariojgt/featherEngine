/** Shared runtime renderer with selection and scale-aware direct manipulation. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { findUIElement, findUIParent } from '../store/editor/ui';
import type { UIDocument, UIElement, UIStyle } from '../types';
import { buildUIContext } from './runtimeContext';
import { UI_ANIMATION_CSS } from './uiAnimations';
import { UIElementView } from './UIElementView';
import { UIStyleSheet, uiDocScopeProps } from './UIStyleSheet';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
interface Rect { left: number; top: number; width: number; height: number }

export function UIEditLayer({ doc, fillParent, snap = 1 }: { doc: UIDocument; fillParent?: boolean; snap?: number }) {
  const variables = useEditorStore((state) => state.variables);
  const assets = useEditorStore((state) => state.assets);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const updateUIElement = useEditorStore((state) => state.updateUIElement);
  const selectedId = useEditorStore((state) => state.selectedUIElementId);
  const selectUIElement = useEditorStore((state) => state.selectUIElement);
  const frameRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<Rect | null>(null);
  const cancelGesture = useRef<() => void>(() => {});
  useEffect(() => () => cancelGesture.current(), [doc.id, selectedId]);

  const ctx = buildUIContext({ variables, runtimeVariableValues: {}, runtimeObjectVariables: {}, isPlaying: false });
  const selected = selectedId ? findUIElement(doc.root, selectedId) : undefined;
  const canEdit = selected && selected.id !== doc.root.id;
  const nodeFor = (id: string) => frameRef.current?.querySelector<HTMLElement>(`[data-uiel-id="${CSS.escape(id)}"]`);
  const scale = () => {
    const frame = frameRef.current;
    return frame?.clientWidth ? frame.getBoundingClientRect().width / frame.clientWidth : 1;
  };

  useLayoutEffect(() => {
    const measure = () => {
      const frame = frameRef.current;
      const node = selectedId ? nodeFor(selectedId) : null;
      if (!frame || !node || !canEdit) { setOverlay((old) => old === null ? old : null); return; }
      const f = frame.getBoundingClientRect(), r = node.getBoundingClientRect(), zoom = scale();
      const next = { left: (r.left - f.left) / zoom, top: (r.top - f.top) / zoom, width: r.width / zoom, height: r.height / zoom };
      setOverlay((old) => old && Object.keys(next).every((key) => old[key as keyof Rect] === next[key as keyof Rect]) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (frameRef.current) observer.observe(frameRef.current);
    const node = selectedId ? nodeFor(selectedId) : null;
    if (node) observer.observe(node);
    frameRef.current?.addEventListener('scroll', measure, true);
    const frame = frameRef.current;
    return () => { observer.disconnect(); frame?.removeEventListener('scroll', measure, true); };
  });

  const beginGesture = (mode: 'move' | Handle, event: React.PointerEvent) => {
    if (!selected || !canEdit || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    cancelGesture.current();
    const node = nodeFor(selected.id);
    const parentId = findUIParent(doc.root, selected.id)?.id;
    const parent = (parentId && nodeFor(parentId)) || frameRef.current;
    if (!node || !parent) return;
    const r = node.getBoundingClientRect(), p = parent.getBoundingClientRect(), zoom = scale();
    const base = { left: (r.left - p.left) / zoom - parent.clientLeft + parent.scrollLeft,
      top: (r.top - p.top) / zoom - parent.clientTop + parent.scrollTop, width: r.width / zoom, height: r.height / zoom };
    const startX = event.clientX, startY = event.clientY;
    const controller = new AbortController();
    let raf: number | undefined;
    let pending: Partial<Omit<UIElement, 'id' | 'children'>> | undefined;
    const flush = () => { raf = undefined; if (pending) { updateUIElement(doc.id, selected.id, pending); pending = undefined; } };
    const clean = () => { controller.abort(); if (raf !== undefined) cancelAnimationFrame(raf); pending = undefined; };
    cancelGesture.current = clean;
    const finish = () => { flush(); clean(); };
    window.addEventListener('pointermove', (move) => {
      const round = (value: number) => Math.round(value / (move.altKey ? 1 : snap)) * (move.altKey ? 1 : snap);
      const dx = (move.clientX - startX) / zoom, dy = (move.clientY - startY) / zoom;
      if (mode === 'move' && selected.anchor) {
        const anchor = selected.anchor;
        pending = { anchor: { ...anchor, offsetX: round(anchor.offsetX + dx * (anchor.h === 'right' ? -1 : 1)),
          offsetY: round(anchor.offsetY + dy * (anchor.v === 'bottom' ? -1 : 1)) } };
      } else {
        let { left, top, width, height } = base;
        if (mode === 'move') { left = round(left + dx); top = round(top + dy); }
        else {
          if (mode.includes('e')) width = Math.max(8, round(base.width + dx));
          if (mode.includes('s')) height = Math.max(8, round(base.height + dy));
          if (mode.includes('w')) { width = Math.max(8, round(base.width - dx)); left = base.left + base.width - width; }
          if (mode.includes('n')) { height = Math.max(8, round(base.height - dy)); top = base.top + base.height - height; }
        }
        const style: UIStyle = { ...selected.style, margin: '0', position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
        pending = { anchor: undefined, style };
      }
      if (raf === undefined) raf = requestAnimationFrame(flush);
    }, { signal: controller.signal });
    window.addEventListener('pointerup', finish, { signal: controller.signal });
    window.addEventListener('pointercancel', finish, { signal: controller.signal });
    window.addEventListener('blur', finish, { signal: controller.signal });
  };

  return <div className="ui-edit-layer" ref={frameRef} {...uiDocScopeProps(doc.id)}
    onPointerDown={(event) => {
      // A source child belongs to its enclosing instance in this document's hierarchy.
      let target = (event.target as HTMLElement).closest<HTMLElement>('[data-uiel-id]');
      while (target && !findUIElement(doc.root, target.dataset.uielId ?? '')) target = target.parentElement?.closest('[data-uiel-id]') ?? null;
      selectUIElement(target?.dataset.uielId ?? doc.root.id);
    }}
    onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <style>{UI_ANIMATION_CSS}</style>
    <UIStyleSheet doc={doc} />
    <UIElementView element={fillParent ? { ...doc.root, anchor: undefined, style: { width: '100%', height: '100%', position: 'relative', ...doc.root.style } } : doc.root}
      ctx={ctx} resolveAssetUrl={(id) => assets.find((asset) => asset.id === id)?.url}
      resolveComponent={(id) => uiDocuments.find((item) => item.id === id)} />
    {overlay && canEdit && <div className="ui-select-box" style={overlay} onPointerDown={(event) => beginGesture('move', event)}>
      {HANDLES.map((handle) => <span key={handle} className={`ui-resize-handle h-${handle}`} onPointerDown={(event) => beginGesture(handle, event)} />)}
    </div>}
  </div>;
}
