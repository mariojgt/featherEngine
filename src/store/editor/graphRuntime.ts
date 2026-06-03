import type { Edge } from '@xyflow/react';
import type { NodeForgeNode, ProjectGraph } from '../../types';

const LAYOUT_COL = 264;
const LAYOUT_ROW = 152;
const LAYOUT_X0 = 48;
const LAYOUT_Y0 = 48;
const LAYOUT_GRID = 24;

/** Layered left-to-right layout that follows execution flow and snaps to a grid. */
export const layoutGraphNodes = (nodes: NodeForgeNode[], edges: Edge[]): NodeForgeNode[] => {
  if (nodes.length === 0) return nodes;
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (adjacency.has(edge.source) && indegree.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  });

  // Longest-path layering (Kahn's algorithm); nodes left in a cycle stay in column 0.
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const remaining = new Map(indegree);
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const current = layer.get(id) ?? 0;
    (adjacency.get(id) ?? []).forEach((target) => {
      layer.set(target, Math.max(layer.get(target) ?? 0, current + 1));
      const next = (remaining.get(target) ?? 0) - 1;
      remaining.set(target, next);
      if (next === 0) queue.push(target);
    });
  }

  const byLayer = new Map<number, string[]>();
  nodes.forEach((node) => {
    const column = layer.get(node.id) ?? 0;
    byLayer.set(column, [...(byLayer.get(column) ?? []), node.id]);
  });

  const snap = (value: number) => Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
  const orderY = new Map(nodes.map((node) => [node.id, node.position.y]));
  const positions = new Map<string, { x: number; y: number }>();
  [...byLayer.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      const ids = byLayer.get(column)!.sort((a, b) => (orderY.get(a) ?? 0) - (orderY.get(b) ?? 0));
      ids.forEach((id, index) => {
        positions.set(id, { x: snap(LAYOUT_X0 + column * LAYOUT_COL), y: snap(LAYOUT_Y0 + index * LAYOUT_ROW) });
      });
    });

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
};

export interface GraphRuntime {
  graph: ProjectGraph;
  nodesById: Map<string, NodeForgeNode>;
  /** Default execution continuation: targets reached via the standard "exec-out" pin. */
  outgoing: Map<string, string[]>;
  /** Execution targets grouped by the source pin they leave from (e.g. "exec-out", "exec-body").
   *  Lets multi-output exec nodes (For Loop's Body vs Completed) route to distinct chains. */
  outgoingByHandle: Map<string, Map<string, string[]>>;
  incomingValues: Map<string, Edge[]>;
  incomingValueByHandle: Map<string, Map<string, Edge>>;
  eventRoots: NodeForgeNode[];
  customEventRoots: Map<string, NodeForgeNode[]>;
}

const graphRuntimeCache = new WeakMap<ProjectGraph, GraphRuntime>();
const graphRuntimeMapCache = new WeakMap<ProjectGraph[], Map<string, GraphRuntime>>();

export const buildGraphRuntime = (graph: ProjectGraph): GraphRuntime => {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const outgoingByHandle = new Map<string, Map<string, string[]>>();
  const incomingValues = new Map<string, Edge[]>();
  const incomingValueByHandle = new Map<string, Map<string, Edge>>();

  graph.edges.forEach((edge) => {
    const isValueEdge = Boolean(edge.targetHandle && edge.targetHandle !== 'exec-in');
    if (isValueEdge) {
      const existing = incomingValues.get(edge.target);
      if (existing) existing.push(edge);
      else incomingValues.set(edge.target, [edge]);
      const byHandle = incomingValueByHandle.get(edge.target) ?? new Map<string, Edge>();
      if (edge.targetHandle) byHandle.set(edge.targetHandle, edge);
      incomingValueByHandle.set(edge.target, byHandle);
    } else {
      // Exec edges leave a node from a named pin. Edges authored before multi-output nodes existed
      // (and AI-created flow edges) carry no sourceHandle → treat them as the default "exec-out".
      const handle = edge.sourceHandle || 'exec-out';
      const byHandle = outgoingByHandle.get(edge.source) ?? new Map<string, string[]>();
      const handleTargets = byHandle.get(handle);
      if (handleTargets) handleTargets.push(edge.target);
      else byHandle.set(handle, [edge.target]);
      outgoingByHandle.set(edge.source, byHandle);
      // The default-pin continuation stays in `outgoing` so existing call sites are unchanged.
      if (handle === 'exec-out') {
        const existing = outgoing.get(edge.source);
        if (existing) existing.push(edge.target);
        else outgoing.set(edge.source, [edge.target]);
      }
    }
  });

  const eventRoots = graph.nodes.filter((node) => node.data.nodeKind?.startsWith('event.'));
  const customEventRoots = new Map<string, NodeForgeNode[]>();
  for (const node of eventRoots) {
    if (node.data.nodeKind !== 'event.custom') continue;
    const key = (node.data.eventName || 'CustomEvent').toLowerCase();
    const existing = customEventRoots.get(key);
    if (existing) existing.push(node);
    else customEventRoots.set(key, [node]);
  }

  return { graph, nodesById, outgoing, outgoingByHandle, incomingValues, incomingValueByHandle, eventRoots, customEventRoots };
};

export const getGraphRuntime = (graph: ProjectGraph): GraphRuntime => {
  const cached = graphRuntimeCache.get(graph);
  if (cached) return cached;
  const runtime = buildGraphRuntime(graph);
  graphRuntimeCache.set(graph, runtime);
  return runtime;
};

export const getGraphRuntimeMap = (graphs: ProjectGraph[]): Map<string, GraphRuntime> => {
  const cached = graphRuntimeMapCache.get(graphs);
  if (cached) return cached;
  const runtimes = new Map(graphs.map((graph) => [graph.id, getGraphRuntime(graph)]));
  graphRuntimeMapCache.set(graphs, runtimes);
  return runtimes;
};
