import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { handleEditorMenuKeyDown } from './editorMenuNavigation';

export type ContextMenuEntry = { label: string; onClick: () => void; danger?: boolean; shortcut?: string } | 'separator';
export interface ContextMenuState { x: number; y: number; items: ContextMenuEntry[]; }

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const menu = menuRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(state.x, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(state.y, innerHeight - bounds.height - 8))}px`;
    menu.querySelector('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [state]);
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('resize', close); };
  }, [state, onClose]);
  if (!state) return null;
  return createPortal(
    <div ref={menuRef} role="menu" aria-label="Context actions" className="context-menu" style={{ left: state.x, top: state.y }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      handleEditorMenuKeyDown(event);
    }}>
      {state.items.map((item, index) => item === 'separator' ? <hr role="separator" key={`sep-${index}`} /> : <button type="button" role="menuitem" key={item.label} className={item.danger ? 'danger' : undefined} onClick={() => { onClose(); item.onClick(); }}><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}
    </div>, document.body,
  );
}
