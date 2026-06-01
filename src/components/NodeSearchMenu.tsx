import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import type { GraphNodeCategory, NodeForgeNodeData } from '../types';

export interface NodeChoice {
  label: string;
  category: GraphNodeCategory;
  nodeLabel?: string;
  data?: Partial<NodeForgeNodeData>;
  action?: 'create-variable';
}

export function NodeSearchMenu({
  x,
  y,
  choices,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  choices: NodeChoice[];
  onPick: (choice: NodeChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((choice) => choice.label.toLowerCase().includes(q)) : choices;
  }, [choices, query]);

  return createPortal(
    <div
      className="node-search"
      style={{ left: Math.min(x, window.innerWidth - 260), top: Math.min(y, window.innerHeight - 360) }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <label className="node-search-field">
        <Search size={14} aria-hidden />
        <input
          autoFocus
          value={query}
          placeholder="Search nodes…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && filtered[active]) {
              event.preventDefault();
              onPick(filtered[active]);
            }
          }}
        />
      </label>
      <div className="node-search-list">
        {filtered.map((choice, index) => (
          <button
            key={`${choice.category}:${choice.label}`}
            className={index === active ? 'active' : undefined}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(choice)}
          >
            <span>{choice.label}</span>
            <small>{choice.category}</small>
          </button>
        ))}
        {filtered.length === 0 && <div className="node-search-empty">No matching nodes</div>}
      </div>
    </div>,
    document.body,
  );
}
