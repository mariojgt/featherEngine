import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import type { GraphValue } from '../types';

/** Render a runtime value compactly: rounded numbers, quoted strings, [x, y, z] vectors. */
function formatValue(value: GraphValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((n) => (Number.isInteger(n) ? n : Number(n).toFixed(2))).join(', ')}]`;
  return `"${value}"`;
}

/**
 * Live variable watch (editor Play only): a compact overlay listing every project variable with its
 * runtime value, updating as the game writes them. Together with the gold exec-flow pulses in the
 * blueprint editor this is the "see what my game is doing" debug pair. Toggle with F9 or the chip.
 * Render cost is trivial — the tick's identity guards mean this only re-renders when a value
 * actually changes, not 60×/s.
 */
export function VariableWatch() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const variables = useEditorStore((state) => state.variables);
  const values = useEditorStore((state) => state.runtimeVariableValues);
  const [open, setOpen] = useState(() => localStorage.getItem('nodeforge.varWatch') === '1');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'F9') return;
      event.preventDefault();
      setOpen((prev) => {
        localStorage.setItem('nodeforge.varWatch', prev ? '0' : '1');
        return !prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!isPlaying || variables.length === 0) return null;

  if (!open) {
    return (
      <button
        className="var-watch-chip"
        title="Variable watch (F9) — live project variable values"
        onClick={() => {
          localStorage.setItem('nodeforge.varWatch', '1');
          setOpen(true);
        }}
      >
        <Eye size={12} aria-hidden /> Vars
      </button>
    );
  }

  return (
    <div className="var-watch">
      <div className="var-watch-head">
        <span>
          <Eye size={12} aria-hidden /> Variables
        </span>
        <button
          title="Hide (F9)"
          onClick={() => {
            localStorage.setItem('nodeforge.varWatch', '0');
            setOpen(false);
          }}
        >
          ×
        </button>
      </div>
      <div className="var-watch-rows">
        {variables.map((variable) => (
          <div className="var-watch-row" key={variable.id}>
            <span className="var-watch-name">{variable.name}</span>
            <span className="var-watch-value">{formatValue(values[variable.id] ?? variable.defaultValue)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
