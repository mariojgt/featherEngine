import { useState, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

/**
 * A collapsible group used by the node palettes (Scripting + Material editors). Collapse state is
 * persisted per-title in localStorage. Pass `forceOpen` (e.g. while a search is active) to expand
 * regardless of the saved state, and an optional `count` badge.
 */
export function PaletteGroup({
  title,
  icon: Icon,
  count,
  forceOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const storageKey = `nf.palette.group.${title}`;
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) !== '0');
  const expanded = forceOpen || open;
  const toggle = () => {
    setOpen((value) => {
      localStorage.setItem(storageKey, value ? '0' : '1');
      return !value;
    });
  };
  return (
    <section className={expanded ? 'palette-group' : 'palette-group collapsed'}>
      <h3
        className="palette-group-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Icon size={14} aria-hidden />
        <span>{title}</span>
        {count !== undefined && <small>{count}</small>}
        <ChevronRight size={12} className="palette-group-caret" aria-hidden />
      </h3>
      {expanded && <div>{children}</div>}
    </section>
  );
}
