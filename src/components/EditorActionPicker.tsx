import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';

export interface EditorAction {
  id: string;
  label: string;
  description: string;
  category: string;
  icon: typeof Search;
  run: () => void;
  disabledReason?: string;
}

/** Shared, keyboard-accessible chooser for scene objects and object components. */
export function EditorActionPicker({ title, description, searchLabel, actions, initialCategory, onClose }: {
  title: string;
  description: string;
  searchLabel: string;
  actions: EditorAction[];
  initialCategory?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(initialCategory ?? 'All');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const categories = useMemo(() => ['All', ...new Set(actions.map((action) => action.category))], [actions]);
  const filtered = actions.filter((action) => query.trim()
    ? `${action.label} ${action.description} ${action.category}`.toLowerCase().includes(query.trim().toLowerCase())
    : category === 'All' || action.category === category);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const run = (action: EditorAction) => {
    if (action.disabledReason) return;
    onClose();
    action.run();
  };

  return createPortal(
    <div className="editor-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="editor-picker" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        onKeyDown={(event) => {
          event.stopPropagation();
          const dialog = dialogRef.current;
          if (!dialog) return;
          if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
          if (event.key === 'Tab') {
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]'));
            const index = controls.indexOf(document.activeElement as HTMLElement);
            if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
          }
          const target = event.target as HTMLElement;
          if (target.closest('.editor-picker-categories')) return;
          const rows = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.editor-picker-result:not(:disabled)'));
          const index = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = event.key === 'ArrowDown' ? (index + 1) % rows.length : (index <= 0 ? rows.length - 1 : index - 1);
            rows[next]?.focus();
          }
          if (target.tagName === 'INPUT' && event.key === 'Enter') {
            event.preventDefault();
            const first = filtered.find((action) => !action.disabledReason);
            if (first) run(first);
          }
        }}>
        <div className="editor-picker-heading">
          <div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
          <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} title="Close (Esc)" onClick={onClose}><X size={16} aria-hidden /></button>
        </div>
        <label className="editor-picker-search"><Search size={16} aria-hidden /><input aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>Esc</kbd></label>
        <div className="editor-picker-body">
          <nav className="editor-picker-categories" aria-label={`${title} categories`}>
            {categories.map((name) => <button type="button" key={name} aria-pressed={!query.trim() && category === name} onClick={() => { setCategory(name); setQuery(''); }}>{name}</button>)}
          </nav>
          <div className="editor-picker-results" aria-label={`${title} results`}>
            <div className="editor-picker-results-heading">{query.trim() ? 'Search results' : category}<span>{filtered.length}</span></div>
            {filtered.map((action) => { const Icon = action.icon; return <button type="button" className="editor-picker-result" key={action.id} data-action-id={action.id} disabled={Boolean(action.disabledReason)} title={action.disabledReason ?? action.description} onClick={() => run(action)}>
              <Icon size={18} aria-hidden /><span><strong>{action.label}</strong><small>{action.disabledReason ?? action.description}</small></span>
            </button>; })}
            {!filtered.length && <div className="editor-empty-state"><Search size={22} aria-hidden /><strong>No matches</strong><p>Try a different name or choose a category.</p><button type="button" onClick={() => { setQuery(''); setCategory('All'); }}>Clear search</button></div>}
          </div>
        </div>
        <div className="editor-picker-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> Browse</span><span><kbd>Enter</kbd> Choose</span><span><kbd>Esc</kbd> Close</span></div>
      </div>
    </div>, document.body,
  );
}
