import type { GraphValue } from '../types';

/**
 * Live value trace for the blueprint editor: while Play runs with a graph editor open, the runtime
 * records the most recent value produced by each value node (as its wires are read). The editor polls
 * this and shows the number/vector/bool/string right on the node — so you watch real data flow through
 * the graph (great for "why is this value wrong?").
 *
 * Same module-singleton, poll-don't-subscribe pattern as {@link ./execTrace}: recording is a no-op
 * unless `enabled` (the VisualScriptingPanel flips it on only when an editor is open during Play), so
 * shipped games and headless ticks pay nothing.
 */
export const valueTrace = {
  enabled: false,
  /** nodeId → most recent value produced this session. */
  values: new Map<string, GraphValue>(),
};

export function recordValue(nodeId: string, value: GraphValue | undefined) {
  if (valueTrace.enabled && value !== undefined) valueTrace.values.set(nodeId, value);
}

export function setValueTraceEnabled(enabled: boolean) {
  valueTrace.enabled = enabled;
  if (!enabled) valueTrace.values.clear();
}

/** Compact, human-readable rendering of a graph value for the on-node readout. */
export function formatTraceValue(value: GraphValue): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.map((n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1))).join(', ');
  const str = String(value);
  return str.length > 18 ? `${str.slice(0, 17)}…` : str;
}
