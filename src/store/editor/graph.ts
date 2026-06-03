import type { Edge } from '@xyflow/react';
import type {
  DataAsset,
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeTone,
  GraphValue,
  GraphValueType,
  NodeForgeNode,
  NodeForgeNodeData,
  ProjectGraph,
  ProjectVariable,
  Vector3Tuple,
} from '../../types';

import { makeId } from './ids';

export const defaultValueForType = (type: GraphValueType): GraphValue => {
  if (type === 'number') return 0;
  if (type === 'string') return '';
  if (type === 'boolean') return false;
  return [0, 0, 0];
};

export const valueTypeOf = (value: GraphValue): GraphValueType => {
  if (Array.isArray(value)) return 'vector3';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
};

export const cloneGraphValue = (value: GraphValue): GraphValue =>
  Array.isArray(value) ? ([value[0], value[1], value[2]] as Vector3Tuple) : value;

export const coerceGraphValue = (value: unknown, type: GraphValueType): GraphValue => {
  if (type === 'number') {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : 0;
  }
  if (type === 'string') return value === undefined || value === null ? '' : String(value);
  if (type === 'boolean') {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return Boolean(value);
  }
  if (Array.isArray(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0] as Vector3Tuple;
  }
  return [0, 0, 0];
};
