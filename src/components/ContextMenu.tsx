import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuEntry = { label: string; onClick: () => void; danger?: boolean } | 'separator';

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  return createPortal(
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {state.items.map((item, index) =>
        item === 'separator' ? (
          <hr key={`sep-${index}`} />
        ) : (
          <button
            key={item.label}
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
