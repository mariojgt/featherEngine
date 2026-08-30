import type { Edge } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { timelineCurvePreset } from '../../runtime/timelineCurve';
import type { NodeForgeNode, ProjectGraph, SceneObject, ScriptBlueprint, Vector3Tuple } from '../../types';
import { worldTransformOf } from '../../utils/transformHierarchy';
import { makeNodeData } from '../editor/graph';
import { useEditorStore } from '../editorStore';

const BP_ID = 'bp-timeline-test';
const GRAPH_ID = 'graph-timeline-test';

const transform = (position: Vector3Tuple = [0, 0, 0], rotation: Vector3Tuple = [0, 0, 0]) => ({
  position,
  rotation,
  scale: [1, 1, 1] as Vector3Tuple,
});

const node = (id: string, label: string, data: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x: 0, y: 0 },
  data: makeNodeData(label, label === 'Start' ? 'Events' : 'Runtime', data),
});

const edge = (id: string, source: string, target: string, sourceHandle = 'exec-out'): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle: 'exec-in',
});

const valueEdge = (id: string, source: string, target: string, targetHandle: string): Edge => ({
  id,
  source,
  target,
  sourceHandle: 'value-out',
  targetHandle,
});

function loadTimelineScene(objects: SceneObject[], timelineData: Partial<NodeForgeNode['data']>, outputs = false) {
  const project = blankProject('Timeline runtime test');
  const nodes: NodeForgeNode[] = [
    node('start', 'Start'),
    node('timeline', 'Timeline', timelineData),
  ];
  const edges: Edge[] = [edge('start-timeline', 'start', 'timeline')];
  if (outputs) {
    nodes.push(node('update-print', 'Print', { message: 'timeline update' }));
    nodes.push(node('finished-print', 'Print', { message: 'timeline finished' }));
    edges.push(edge('timeline-update', 'timeline', 'update-print', 'exec-update'));
    edges.push(edge('timeline-finished', 'timeline', 'finished-print', 'exec-done'));
  }
  const graph: ProjectGraph = { id: GRAPH_ID, name: 'Timeline Test Graph', nodes, edges };
  const blueprint: ScriptBlueprint = {
    id: BP_ID,
    name: 'Timeline Test',
    description: '',
    graphId: GRAPH_ID,
    color: '#5bd1ff',
    variables: [],
    createdAt: 1,
  };
  project.graphs = [graph];
  project.blueprints = [blueprint];
  project.scenes[0].objects = objects;
  useEditorStore.getState().loadProject(project);
  useEditorStore.getState().setPlaying(true);
  // Start fires and arms the Timeline. Playback begins on the next simulation tick.
  useEditorStore.getState().tickRuntime(0);
}

function loadControlledTimelineScene(objects: SceneObject[]) {
  const project = blankProject('Controlled Timeline runtime test');
  const timeline = node('timeline-definition', 'Timeline', {
    timelineId: 'door-swing',
    timelineName: 'Door Swing',
    tweenProperty: 'position',
    vectorValue: [10, 0, 0],
    numberValue: 1,
    tweenCurve: timelineCurvePreset('linear'),
    tweenSpace: 'local',
    tweenValueMode: 'relative',
  });
  const nodes: NodeForgeNode[] = [timeline, node('finished-print', 'Print', { message: 'controlled finished' })];
  const edges: Edge[] = [edge('timeline-finished', timeline.id, 'finished-print', 'exec-done')];
  for (const command of ['play', 'restart', 'reverse', 'stop'] as const) {
    const eventId = `event-${command}`;
    const controlId = `control-${command}`;
    nodes.push(node(eventId, 'Custom Event', { eventName: command }));
    nodes.push(
      node(controlId, 'Timeline Control', {
        timelineRefId: 'door-swing',
        timelineCommand: command,
      }),
    );
    edges.push(edge(`${eventId}-${controlId}`, eventId, controlId));
  }
  const graph: ProjectGraph = { id: GRAPH_ID, name: 'Controlled Timeline Graph', nodes, edges };
  const blueprint: ScriptBlueprint = {
    id: BP_ID,
    name: 'Controlled Timeline',
    description: '',
    graphId: GRAPH_ID,
    color: '#5bd1ff',
    variables: [],
    createdAt: 1,
  };
  project.graphs = [graph];
  project.blueprints = [blueprint];
  project.scenes[0].objects = objects;
  useEditorStore.getState().loadProject(project);
  useEditorStore.getState().setPlaying(true);
  useEditorStore.getState().tickRuntime(0);
}

const fireTimelineCommand = (command: 'play' | 'restart' | 'reverse' | 'stop') => {
  useEditorStore.getState().fireCustomEvent(command);
  useEditorStore.getState().tickRuntime(0);
};

describe('curve-driven runtime Timeline', () => {
  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Timeline cleanup'));
  });

  it('animates a relative local-space door, pulses Update, and fires Finished once', () => {
    const door: SceneObject = {
      id: 'door',
      name: 'Door',
      kind: 'cube',
      transform: transform([0, 0, 0], [0, Math.PI / 6, 0]),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadTimelineScene(
      [door],
      {
        tweenProperty: 'rotation',
        vectorValue: [0, 90, 0],
        numberValue: 1,
        tweenCurve: timelineCurvePreset('linear'),
        tweenSpace: 'local',
        tweenValueMode: 'relative',
      },
      true,
    );

    useEditorStore.getState().tickRuntime(0.5);
    let liveDoor = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === 'door')!;
    expect(liveDoor.transform.rotation[1]).toBeCloseTo(Math.PI / 6 + Math.PI / 4, 5);
    expect(useEditorStore.getState().runtimeLog.filter((line) => line.endsWith(': timeline update'))).toHaveLength(1);
    expect(useEditorStore.getState().runtimeLog.some((line) => line.endsWith(': timeline finished'))).toBe(false);

    useEditorStore.getState().tickRuntime(0.5);
    liveDoor = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === 'door')!;
    expect(liveDoor.transform.rotation[1]).toBeCloseTo(Math.PI / 6 + Math.PI / 2, 5);
    expect(useEditorStore.getState().runtimeLog.filter((line) => line.endsWith(': timeline update'))).toHaveLength(2);
    expect(useEditorStore.getState().runtimeLog.filter((line) => line.endsWith(': timeline finished'))).toHaveLength(1);

    useEditorStore.getState().tickRuntime(0.5);
    expect(useEditorStore.getState().runtimeLog.filter((line) => line.endsWith(': timeline finished'))).toHaveLength(1);
  });

  it('captures a cross-object Set Rotation as the start of a following Timeline', () => {
    const project = blankProject('Cross-object Timeline handoff test');
    const controller: SceneObject = {
      id: 'controller',
      name: 'Controller',
      kind: 'empty',
      transform: transform(),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    const limb: SceneObject = {
      id: 'limb',
      name: 'Limb',
      kind: 'cube',
      parentId: controller.id,
      transform: transform(),
    };
    const nodes: NodeForgeNode[] = [
      node('start', 'Start'),
      node('start-pose', 'Set Rotation', { targetObjectId: limb.id }),
      node('start-pose-value', 'Vector3', { vectorValue: [-30, 0, 0] }),
      node('swing', 'Timeline', {
        targetObjectId: limb.id,
        tweenProperty: 'rotation',
        vectorValue: [30, 0, 0],
        numberValue: 1,
        tweenCurve: timelineCurvePreset('linear'),
        tweenSpace: 'local',
        tweenValueMode: 'absolute',
      }),
    ];
    const graph: ProjectGraph = {
      id: GRAPH_ID,
      name: 'Cross-object Timeline handoff graph',
      nodes,
      edges: [
        edge('start-set', 'start', 'start-pose'),
        edge('set-swing', 'start-pose', 'swing'),
        valueEdge('pose-value', 'start-pose-value', 'start-pose', 'rotation'),
      ],
    };
    project.graphs = [graph];
    project.blueprints = [{
      id: BP_ID,
      name: 'Cross-object Timeline handoff',
      description: '',
      graphId: GRAPH_ID,
      color: '#5bd1ff',
      variables: [],
      createdAt: 1,
    }];
    project.scenes[0].objects = [controller, limb];
    useEditorStore.getState().loadProject(project);
    useEditorStore.getState().setPlaying(true);
    useEditorStore.getState().tickRuntime(0);

    let liveLimb = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === limb.id)!;
    let session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(session.from[0]).toBeCloseTo(-Math.PI / 6, 5);
    expect(liveLimb.transform.rotation[0]).toBeCloseTo(-Math.PI / 6, 5);

    useEditorStore.getState().tickRuntime(0.5);
    liveLimb = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === limb.id)!;
    session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(session.time).toBeCloseTo(0.5, 5);
    expect(liveLimb.transform.rotation[0]).toBeCloseTo(0, 5);
  });

  it('converts an absolute world-space track through a rotated parent', () => {
    const parent: SceneObject = {
      id: 'hinge-parent',
      name: 'Hinge Parent',
      kind: 'empty',
      transform: transform([10, 0, 0], [0, Math.PI / 2, 0]),
    };
    const child: SceneObject = {
      id: 'door',
      name: 'Parented Door',
      kind: 'cube',
      parentId: parent.id,
      transform: transform([1, 0, 0]),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadTimelineScene([parent, child], {
      tweenProperty: 'position',
      vectorValue: [12, 2, -3],
      numberValue: 1,
      tweenCurve: timelineCurvePreset('linear'),
      tweenSpace: 'world',
      tweenValueMode: 'absolute',
    });

    useEditorStore.getState().tickRuntime(1);
    const objects = useEditorStore.getState().activeScene()!.objects;
    const world = worldTransformOf(objects, child.id);
    expect(world.position[0]).toBeCloseTo(12, 5);
    expect(world.position[1]).toBeCloseTo(2, 5);
    expect(world.position[2]).toBeCloseTo(-3, 5);
  });

  it('freezes while Play is paused and ping-pongs when looping', () => {
    const mover: SceneObject = {
      id: 'mover',
      name: 'Mover',
      kind: 'cube',
      transform: transform(),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadTimelineScene([mover], {
      tweenProperty: 'position',
      vectorValue: [2, 0, 0],
      numberValue: 1,
      tweenCurve: timelineCurvePreset('linear'),
      tweenSpace: 'local',
      tweenValueMode: 'relative',
      tweenLoop: true,
      tweenPingPong: true,
    });

    useEditorStore.getState().setPlayPaused(true);
    useEditorStore.getState().tickRuntime(0.5);
    let live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(0);

    useEditorStore.getState().setPlayPaused(false);
    useEditorStore.getState().tickRuntime(1.25);
    live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(1.5, 5);
    expect(Object.keys(useEditorStore.getState().runtimeTweens)).toHaveLength(1);
  });

  it('plays a detached definition and reverses smoothly from the current time', () => {
    const mover: SceneObject = {
      id: 'mover',
      name: 'Controlled mover',
      kind: 'cube',
      transform: transform(),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadControlledTimelineScene([mover]);

    expect(Object.keys(useEditorStore.getState().runtimeTweens)).toHaveLength(0);
    fireTimelineCommand('play');
    useEditorStore.getState().tickRuntime(0.4);
    let live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(4, 5);

    fireTimelineCommand('reverse');
    const reversing = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(reversing.direction).toBe(-1);
    expect(reversing.time).toBeCloseTo(0.4, 5);
    useEditorStore.getState().tickRuntime(0.4);
    live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(0, 5);
    expect(Object.values(useEditorStore.getState().runtimeTweens)[0].playing).toBe(false);
    expect(useEditorStore.getState().runtimeLog.filter((line) => line.endsWith(': controlled finished'))).toHaveLength(1);
  });

  it('stops and holds, then resumes forward from the held time', () => {
    const mover: SceneObject = {
      id: 'mover',
      name: 'Controlled mover',
      kind: 'cube',
      transform: transform(),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadControlledTimelineScene([mover]);
    fireTimelineCommand('play');
    useEditorStore.getState().tickRuntime(0.4);
    fireTimelineCommand('stop');
    useEditorStore.getState().tickRuntime(2);

    let live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(4, 5);
    let session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(session.playing).toBe(false);
    expect(session.time).toBeCloseTo(0.4, 5);

    fireTimelineCommand('play');
    useEditorStore.getState().tickRuntime(0.3);
    live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(live.transform.position[0]).toBeCloseTo(7, 5);
    expect(session.playing).toBe(true);
    expect(session.time).toBeCloseTo(0.7, 5);
  });

  it('retains a completed session for Reverse and restarts from its original captured start', () => {
    const mover: SceneObject = {
      id: 'mover',
      name: 'Controlled mover',
      kind: 'cube',
      transform: transform([2, 0, 0]),
      script: { blueprintId: BP_ID, graphId: GRAPH_ID, enabled: true },
    };
    loadControlledTimelineScene([mover]);
    fireTimelineCommand('play');
    useEditorStore.getState().tickRuntime(1);
    let session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(session.playing).toBe(false);
    expect(session.time).toBe(1);

    fireTimelineCommand('reverse');
    useEditorStore.getState().tickRuntime(0.5);
    let live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(7, 5);

    fireTimelineCommand('restart');
    live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    session = Object.values(useEditorStore.getState().runtimeTweens)[0];
    expect(live.transform.position[0]).toBeCloseTo(2, 5);
    expect(session.from[0]).toBeCloseTo(2, 5);
    expect(session.time).toBe(0);
    useEditorStore.getState().tickRuntime(0.25);
    live = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === mover.id)!;
    expect(live.transform.position[0]).toBeCloseTo(4.5, 5);
  });

  it('remaps copied Timeline identities together while a copied Control alone keeps its reference', () => {
    const project = blankProject('Timeline copy test');
    const timeline = node('timeline-source', 'Timeline', {
      timelineId: 'door-swing',
      timelineName: 'Door Swing',
      tweenCurve: timelineCurvePreset('linear'),
    });
    const control = node('control-source', 'Timeline Control', {
      timelineRefId: 'door-swing',
      timelineCommand: 'reverse',
    });
    const graph: ProjectGraph = { id: GRAPH_ID, name: 'Timeline copy graph', nodes: [timeline, control], edges: [] };
    project.graphs = [graph];
    project.blueprints = [{
      id: BP_ID,
      name: 'Timeline copy',
      description: '',
      graphId: GRAPH_ID,
      color: '#5bd1ff',
      variables: [],
      createdAt: 1,
    }];
    useEditorStore.getState().loadProject(project);

    const [copiedTimelineId, copiedControlId] = useEditorStore
      .getState()
      .pasteGraphNodes(BP_ID, [timeline, control], [], { x: 40, y: 40 });
    let copiedGraph = useEditorStore.getState().graphs.find((item) => item.id === GRAPH_ID)!;
    const copiedTimeline = copiedGraph.nodes.find((item) => item.id === copiedTimelineId)!;
    const copiedControl = copiedGraph.nodes.find((item) => item.id === copiedControlId)!;
    expect(copiedTimeline.data.timelineId).not.toBe('door-swing');
    expect(copiedControl.data.timelineRefId).toBe(copiedTimeline.data.timelineId);

    const [controlOnlyId] = useEditorStore.getState().pasteGraphNodes(BP_ID, [control], [], { x: 80, y: 80 });
    copiedGraph = useEditorStore.getState().graphs.find((item) => item.id === GRAPH_ID)!;
    expect(copiedGraph.nodes.find((item) => item.id === controlOnlyId)!.data.timelineRefId).toBe('door-swing');
  });
});
