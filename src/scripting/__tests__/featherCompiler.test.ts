import { describe, expect, it } from 'vitest';
import { graphToFeatherScript } from '../featherScript';
import { compileFeatherScriptToGraph } from '../featherCompiler';
import type { ProjectGraph, ProjectVariable, ScriptBlueprint } from '../../types';

const blueprint: ScriptBlueprint = {
  id: 'bp-player',
  name: 'Player',
  description: '',
  graphId: 'graph-player',
  color: '#3DDC97',
  variables: [],
  createdAt: 1,
};

const graph: ProjectGraph = {
  id: 'graph-player',
  name: 'Player Graph',
  nodes: [],
  edges: [],
};

const score: ProjectVariable = {
  id: 'var-score',
  name: 'Score',
  type: 'number',
  defaultValue: 0,
  persistent: false,
  createdAt: 1,
};

describe('compileFeatherScriptToGraph', () => {
  it('preserves arithmetic between complete function calls, including quoted parentheses', () => {
    const result = compileFeatherScriptToGraph({ blueprint, graph, variables: [], source: `blueprint Armor
on start:
    self.total = get_var(self, "incoming)") + max(0, 30 - get_var(self, "armor"))` });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const nodes = result.graph!.nodes;
    const add = nodes.find(n => n.data.nodeKind === 'math.add')!;
    expect(add).toBeDefined();
    const inputs = result.graph!.edges.filter(e => e.target === add.id)
      .map(e => nodes.find(n => n.id === e.source)!.data);
    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKind: 'variable.getObject', objectKey: 'incoming)' }),
      expect.objectContaining({ nodeKind: 'math.max' }),
    ]));
    expect(nodes.some(n => n.data.nodeKind === 'math.subtract')).toBe(true);
    expect(nodes.some(n => n.data.objectKey === 'armor')).toBe(true);
  });

  it('round-trips frame delta and angular velocity as typed graph operations', () => {
    const result = compileFeatherScriptToGraph({ blueprint, graph, variables: [], source: `blueprint Motion
var clock: number = 0
on update(dt):
    self.clock = self.clock + dt
    set_angular_velocity(self, vec3(0, 2, 0))` });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const update = result.graph!.nodes.find(node => node.data.nodeKind === 'event.update')!;
    expect(result.graph!.edges.some(edge => edge.source === update.id && edge.sourceHandle === 'value-out')).toBe(true);
    expect(result.graph!.nodes.some(node => node.data.nodeKind === 'action.setAngularVelocity')).toBe(true);
    const printed = graphToFeatherScript({ blueprint: result.blueprint!, graph: result.graph!, variables: [] });
    expect(printed).toContain('dt');
    expect(printed).toContain('set_angular_velocity(self, vec3(0, 2, 0))');
    const roundtrip = compileFeatherScriptToGraph({ blueprint, graph, variables: [], source: printed });
    expect(roundtrip.ok).toBe(true);
    expect(roundtrip.diagnostics).toEqual([]);
  });

  it('keeps computed vector components as expressions instead of replacing them with zero', () => {
    const result = compileFeatherScriptToGraph({ blueprint, graph, variables: [], source: [
      'blueprint Throw_Direction',
      'var yaw: number = 90',
      'on start:',
      '    set_velocity(self, vec3(sin(self.yaw), 4, cos(self.yaw)))',
    ].join('\n') });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const makeVector = result.graph!.nodes.find(n => n.data.nodeKind === 'math.makeVector')!;
    expect(makeVector).toBeDefined();
    for (const [component, kind] of [['x', 'math.sin'], ['z', 'math.cos']]) {
      const source = result.graph!.nodes.find(n => n.data.nodeKind === kind)!;
      expect(result.graph!.edges).toContainEqual(expect.objectContaining({ source: source.id, target: makeVector.id, targetHandle: component }));
    }
  });

  it('applies script events, variables, calls, and conditions to a graph', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [score],
      source: [
        'blueprint Player',
        '',
        'var health: number = 100',
        '',
        'on start:',
        '    print("Ready")',
        '    self.translate(axis: "x", amount: 2)',
        '',
        'on update(dt):',
        '    if Game.Score > 10:',
        '        self.jump()',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(result.blueprint?.variables?.[0]).toMatchObject({ name: 'health', type: 'number', defaultValue: 100 });
    expect(result.blueprint?.featherSource).toBeUndefined();

    const kinds = result.graph?.nodes.map((node) => node.data.nodeKind) ?? [];
    expect(kinds).toEqual(
      expect.arrayContaining([
        'event.start',
        'action.print',
        'action.translate',
        'event.update',
        'logic.branch',
        'logic.compare',
        'variable.get',
        'value.number',
        'action.jump',
      ]),
    );

    const branch = result.graph?.nodes.find((node) => node.data.nodeKind === 'logic.branch');
    const compare = result.graph?.nodes.find((node) => node.data.nodeKind === 'logic.compare');
    expect(result.graph?.edges).toContainEqual(expect.objectContaining({ source: compare?.id, target: branch?.id, targetHandle: 'condition' }));
  });

  it('refuses to apply scripts with syntax errors', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source: ['blueprint Broken', 'function Move', '    self.jump()'].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('must end with'))).toBe(true);
  });

  it('can preserve edited source while live-syncing the graph', () => {
    const source = ['blueprint Player', '', 'on start:', '    self.jump()'].join('\n');
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source,
      preserveSource: true,
    });

    expect(result.ok).toBe(true);
    expect(result.blueprint?.featherSource).toBe(source);
    expect(result.graph?.nodes.some((node) => node.data.nodeKind === 'action.jump')).toBe(true);
  });

  it('refuses unsupported statements instead of compiling them into comment nodes', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source: ['blueprint Player', '', 'on start:', '    for x in bananas:', '        print(x)'].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.toLowerCase().includes('unsupported'))).toBe(true);
  });

  it('refuses unknown function calls, with a typo hint', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source: ['blueprint Player', '', 'on start:', '    prnt("Ready")'].join('\n'),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('did you mean print()'))).toBe(true);
  });

  it('still compiles a call when the function is declared in the same script', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source: ['blueprint Player', '', 'on start:', '    Boost(1)', '', 'function Boost(a, b, c):', '    print(a)'].join('\n'),
    });
    expect(result.ok).toBe(true);
    expect(result.graph?.nodes.some((node) => node.data.nodeKind === 'logic.callFunction')).toBe(true);
  });
});
