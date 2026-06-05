import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import type { GraphNodeCategory, GraphNodeKind, GraphValueType, NodeForgeNodeData } from '../types';

export interface NodeChoice {
  label: string;
  category: GraphNodeCategory;
  description?: string;
  nodeKind?: GraphNodeKind;
  valueType?: GraphValueType | 'exec' | 'any';
  nodeLabel?: string;
  data?: Partial<NodeForgeNodeData>;
  action?: 'create-variable';
}

const valueTypeLabels: Record<NonNullable<NodeChoice['valueType']>, string> = {
  exec: 'Exec',
  number: 'Number',
  boolean: 'Bool',
  string: 'String',
  vector3: 'Vec3',
  any: 'Value',
};

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
    return q
      ? choices.filter((choice) =>
          [choice.label, choice.nodeLabel, choice.category, choice.description, choice.nodeKind]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q)),
        )
      : choices;
  }, [choices, query]);

  const grouped = useMemo(() => {
    const groups: Array<{ category: GraphNodeCategory; choices: NodeChoice[] }> = [];
    for (const choice of filtered) {
      const group = groups.find((item) => item.category === choice.category);
      if (group) group.choices.push(choice);
      else groups.push({ category: choice.category, choices: [choice] });
    }
    return groups;
  }, [filtered]);

  return createPortal(
    <div
      className="node-search"
      style={{ left: Math.min(x, window.innerWidth - 390), top: Math.min(y, window.innerHeight - 470) }}
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
        {grouped.map((group) => (
          <section className="node-search-group" key={group.category}>
            <div className="node-search-group-title">
              <span>{group.category}</span>
              <small>{group.choices.length}</small>
            </div>
            {group.choices.map((choice) => {
              const index = filtered.indexOf(choice);
              return (
                <button
                  key={`${choice.category}:${choice.label}`}
                  className={index === active ? 'active' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(choice)}
                >
                  <span className="node-search-result-main">
                    <span className="node-search-result-title">{choice.label}</span>
                    {choice.description && <small>{choice.description}</small>}
                  </span>
                  <span className={`node-search-pill ${choice.valueType ? `value-${choice.valueType}` : ''}`}>
                    {valueTypeLabels[choice.valueType ?? 'exec']}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {filtered.length === 0 && <div className="node-search-empty">No matching nodes</div>}
      </div>
    </div>,
    document.body,
  );
}
