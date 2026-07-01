import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { buildGraphRuntime } from '../editor/graphRuntime';
import type { GraphNodeCategory, GraphNodeKind, GraphNodeTone, NodeForgeNode, ProjectGraph } from '../../types';

const nodeTone = (kind: GraphNodeKind): GraphNodeTone => {
  if (kind.startsWith('event.')) return 'event';
  if (kind.startsWith('logic.')) return 'logic';
  if (kind.startsWith('value.')) return 'value';
  return 'runtime';
};

const nodeCategory = (kind: GraphNodeKind): GraphNodeCategory => {
  if (kind.startsWith('event.')) return 'Events';
  if (kind.startsWith('logic.')) return 'Logic';
  if (kind.startsWith('value.')) return 'Values';
  return 'Runtime';
};

const makeNode = (id: string, kind: GraphNodeKind, data: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeKind: kind,
    category: nodeCategory(kind),
    description: '',
    tone: nodeTone(kind),
    ...data,
  },
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle = 'exec-in',
): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
});

describe('buildGraphRuntime', () => {
  it('compiles exec and value wiring while preserving legacy maps', () => {
    const graph: ProjectGraph = {
      id: 'graph',
      name: 'Graph',
      nodes: [
        makeNode('start', 'event.start'),
        makeNode('branch', 'logic.branch'),
        makeNode('true-print', 'action.print'),
        makeNode('default-print', 'action.print'),
        makeNode('num', 'value.number', { numberValue: 1 }),
        makeNode('function-entry', 'event.functionEntry', { functionName: 'DoThing' }),
        makeNode('function-print', 'action.print'),
      ],
      edges: [
        makeEdge('start-branch', 'start', 'branch'),
        makeEdge('branch-true', 'branch', 'true-print', 'exec-true'),
        makeEdge('branch-default', 'branch', 'default-print', 'exec-out'),
        makeEdge('num-branch', 'num', 'branch', 'value-out', 'condition'),
        makeEdge('function-print', 'function-entry', 'function-print'),
      ],
    };

    const runtime = buildGraphRuntime(graph);

    expect(runtime.compiledNodesById.get('start')?.outgoing).toEqual(['branch']);
    expect(runtime.compiledNodesById.get('branch')?.outgoing).toEqual(['default-print']);
    expect(runtime.compiledNodesById.get('branch')?.outgoingByHandle.get('exec-true')).toEqual(['true-print']);
    expect(runtime.compiledNodesById.get('branch')?.valueInputs.get('condition')).toEqual({
      source: 'num',
      sourceHandle: 'value-out',
    });

    expect(runtime.outgoing.get('branch')).toEqual(['default-print']);
    expect(runtime.outgoingByHandle.get('branch')?.get('exec-true')).toEqual(['true-print']);
    expect(runtime.incomingValueByHandle.get('branch')?.get('condition')?.source).toBe('num');

    expect(runtime.eventRoots.map((root) => root.id)).toEqual(['start', 'function-entry']);
    expect(runtime.dispatchEventRoots.map((root) => root.id)).toEqual(['start']);
    expect(runtime.functionRoots.get('dothing')?.map((root) => root.id)).toEqual(['function-entry']);
  });
});
