import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { toNumber, toVector3 } from '../editor/objectFactory';
import { scanBlueprintGraphProblems, sanitizeGraph } from '../editor/graphDiagnostics';
import { makeNodeData } from '../editor/graph';
import {
  inputTypeForHandle,
  isGraphConnectionValid,
  outputTypeForHandle,
  valueProducerKinds,
} from '../editor/wireTypes';
import { scanProblems } from '../../components/ProblemsPanel';
import type { NodeForgeNode, ProjectGraph, ScriptBlueprint } from '../../types';

const makeNode = (id: string, kind: NodeForgeNode['data']['nodeKind'], extra: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeKind: kind,
    category: 'Runtime',
    description: '',
    tone: 'runtime',
    ...extra,
  },
});

const blueprint: ScriptBlueprint = {
  id: 'bp-1',
  name: 'Guard',
  description: '',
  graphId: 'g-1',
  color: '#3DDC97',
  variables: [],
  createdAt: 1,
};

describe('script reliability', () => {
  it('coerces NaN and Infinity graph numbers to 0 so transforms never poison', () => {
    expect(toNumber(Number.NaN)).toBe(0);
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toNumber('nope')).toBe(0);
    expect(toVector3([Number.NaN, 2, Number.POSITIVE_INFINITY])).toEqual([0, 2, 0]);
  });

  it('rejects number→vector3 wires', () => {
    expect(isGraphConnectionValid('value.number', 'action.translate', 'value-out', 'vector')).toBe(false);
    expect(isGraphConnectionValid('value.vector3', 'action.translate', 'value-out', 'vector')).toBe(true);
    expect(isGraphConnectionValid('event.start', 'action.jump', 'exec-out', 'exec-in')).toBe(true);
    expect(isGraphConnectionValid('event.start', 'action.jump', 'exec-out', 'vector')).toBe(false);
  });

  it('keeps AI and physics queries as typed value nodes', () => {
    const expected = [
      ['ai.distanceToPlayer', 'number'],
      ['ai.directionToPlayer', 'vector3'],
      ['ai.hasLineOfSight', 'boolean'],
      ['query.overlapSphere', 'boolean'],
      ['query.sphereCast', 'boolean'],
      ['query.cableTension', 'number'],
      ['query.getSpeed', 'number'],
    ] as const;

    for (const [kind, output] of expected) {
      const data = makeNodeData(kind, 'Physics', { nodeKind: kind });
      expect(valueProducerKinds.has(kind)).toBe(true);
      expect(data.hasInput).toBe(false);
      expect(data.hasOutput).toBe(true);
      expect(outputTypeForHandle(kind, 'value-out')).toBe(output);
    }
  });

  it('types the Apply Force at Point pins like the rest of the impulse actions', () => {
    expect(inputTypeForHandle('action.applyForceAtPoint', 'vector')).toBe('vector3');
    expect(inputTypeForHandle('action.applyForceAtPoint', 'point')).toBe('vector3');
    expect(inputTypeForHandle('action.applyForceAtPoint', 'target')).toBe('any');
    expect(inputTypeForHandle('action.applyForceAtPoint', 'amount')).toBe('number');
    expect(isGraphConnectionValid('value.number', 'action.applyForceAtPoint', 'value-out', 'vector')).toBe(false);
    expect(isGraphConnectionValid('value.vector3', 'action.applyForceAtPoint', 'value-out', 'point')).toBe(true);
    expect(isGraphConnectionValid('value.vector3', 'query.getSpeed', 'value-out', 'target')).toBe(true);
  });

  it('uses the real boolean and open-ended input types instead of defaulting every pin to number', () => {
    expect(inputTypeForHandle('logic.and', 'a')).toBe('boolean');
    expect(inputTypeForHandle('logic.not', 'value')).toBe('boolean');
    expect(inputTypeForHandle('animator.setBool', 'value')).toBe('boolean');
    expect(inputTypeForHandle('action.setVisible', 'visible')).toBe('boolean');
    expect(inputTypeForHandle('action.setPhysics', 'enabled')).toBe('boolean');
    expect(inputTypeForHandle('action.fireEvent', 'payload')).toBe('any');
    expect(isGraphConnectionValid('value.boolean', 'action.setVisible', 'value-out', 'visible')).toBe(true);
    expect(isGraphConnectionValid('value.number', 'action.setVisible', 'value-out', 'visible')).toBe(false);
    expect(isGraphConnectionValid('value.string', 'action.fireEvent', 'value-out', 'payload')).toBe(true);
  });

  it('flags dangling wires and Call Function with no Function node', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('call', 'logic.callFunction', { functionName: 'Heal' })],
      edges: [{ id: 'e1', source: 'missing', target: 'call', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge],
    };
    const problems = scanBlueprintGraphProblems(blueprint, graph, []);
    expect(problems.some((problem) => problem.message.includes('missing node'))).toBe(true);
    expect(problems.some((problem) => problem.message.includes('Call Function'))).toBe(true);
  });

  it('warns about missing and duplicate logical Timeline references', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [
        makeNode('timeline-a', 'action.tweenProperty', { timelineId: 'door-swing' }),
        makeNode('timeline-b', 'action.tweenProperty', { timelineId: 'door-swing' }),
        makeNode('control', 'action.timelineControl', { timelineRefId: 'missing-track', timelineCommand: 'play' }),
      ],
      edges: [],
    };
    const problems = scanBlueprintGraphProblems(blueprint, graph, []);
    expect(problems.some((problem) => problem.message.includes('share the id "door-swing"'))).toBe(true);
    expect(problems.some((problem) => problem.message.includes('missing Timeline'))).toBe(true);
  });

  it('surfaces those graph issues in the Problems scan', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('start', 'event.start')],
      edges: [{ id: 'e1', source: 'start', target: 'gone', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge],
    };
    const problems = scanProblems([], [graph], [blueprint], [], [], [], []);
    expect(problems.some((problem) => problem.severity === 'error' && problem.message.includes('missing node'))).toBe(true);
  });

  it('strips dangling wires from a loaded graph without touching valid ones', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('start', 'event.start'), makeNode('jump', 'action.jump')],
      edges: [
        { id: 'ok', source: 'start', target: 'jump', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge,
        { id: 'ghost', source: 'start', target: 'gone', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge,
      ],
    };
    const cleaned = sanitizeGraph(graph);
    expect(cleaned.edges).toHaveLength(1);
    expect(cleaned.edges[0]?.id).toBe('ok');
    expect(sanitizeGraph(cleaned)).toBe(cleaned);
  });

  it('keeps only the last loaded value wire for a single input, matching runtime resolution', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Single Input',
      nodes: [
        makeNode('first', 'value.number'),
        makeNode('second', 'value.number'),
        makeNode('rotate', 'action.rotate'),
      ],
      edges: [
        { id: 'old', source: 'first', target: 'rotate', sourceHandle: 'value-out', targetHandle: 'amount' } as Edge,
        { id: 'latest', source: 'second', target: 'rotate', sourceHandle: 'value-out', targetHandle: 'amount' } as Edge,
      ],
    };
    expect(sanitizeGraph(graph).edges.map((edge) => edge.id)).toEqual(['latest']);
  });
});
