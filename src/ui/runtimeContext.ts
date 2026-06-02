/**
 * Builds the data context that UI bindings evaluate against (see `expression.ts`).
 *
 * - `vars`: project variables keyed by **name**. During Play we read live values from
 *   `runtimeVariableValues`; in the editor (not playing) we fall back to each variable's
 *   `defaultValue` so the preview shows representative data.
 * - `self`: present for world-space docs anchored to an object — the object's instance
 *   variables plus `name`/`x`/`y`/`z`, so a binding can read `self.health`.
 */
import type { GraphValue, ProjectVariable, SceneObject } from '../types';
import type { UIExprContext } from './expression';

export interface BuildUIContextInput {
  variables: ProjectVariable[];
  runtimeVariableValues: Record<string, GraphValue>;
  runtimeObjectVariables: Record<string, Record<string, GraphValue>>;
  isPlaying: boolean;
  /** Host object for world-space docs (supplies `self.*`). */
  host?: SceneObject;
}

export function buildUIContext(input: BuildUIContextInput): UIExprContext {
  const { variables, runtimeVariableValues, runtimeObjectVariables, isPlaying, host } = input;

  const vars: Record<string, unknown> = {};
  for (const variable of variables) {
    vars[variable.name] = isPlaying ? runtimeVariableValues[variable.id] ?? variable.defaultValue : variable.defaultValue;
  }

  let self: Record<string, unknown> | undefined;
  if (host) {
    const live = isPlaying ? runtimeObjectVariables[host.id] : undefined;
    self = {
      ...(host.variables ?? {}),
      ...(live ?? {}),
      name: host.name,
      x: host.transform.position[0],
      y: host.transform.position[1],
      z: host.transform.position[2],
    };
  }

  return { vars, self };
}
