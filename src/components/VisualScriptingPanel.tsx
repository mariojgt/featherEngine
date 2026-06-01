import { Background, Controls, MiniMap, ReactFlow, type NodeTypes } from '@xyflow/react';
import { Boxes, GitBranch, LayoutGrid, MousePointer2, Plus, Send, Sigma, Waypoints, Zap } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { NodeForgeGraphNode } from './NodeForgeGraphNode';
import type { GraphNodeCategory, NodeForgeNode } from '../types';

const nodeTypes: NodeTypes = {
  nodeforge: NodeForgeGraphNode,
};

const nodeGroups: Array<{
  title: GraphNodeCategory;
  icon: typeof Zap;
  nodes: string[];
}> = [
  {
    title: 'Events',
    icon: Zap,
    nodes: ['Start', 'Update', 'Key Down', 'Key Up', 'Custom Event', 'Collision Enter'],
  },
  {
    title: 'Logic',
    icon: GitBranch,
    nodes: ['Branch', 'Compare', 'AND', 'OR'],
  },
  {
    title: 'Math',
    icon: Sigma,
    nodes: ['Add', 'Clamp', 'Lerp', 'Vector3'],
  },
  {
    title: 'Runtime',
    icon: Waypoints,
    nodes: ['Translate', 'Rotate', 'Fire Event', 'Apply Force', 'Spawn Object', 'Play Sound'],
  },
];

const keyOptions = [
  ['KeyW', 'W'],
  ['KeyA', 'A'],
  ['KeyS', 'S'],
  ['KeyD', 'D'],
  ['Space', 'Space'],
  ['ArrowUp', 'Arrow Up'],
  ['ArrowDown', 'Arrow Down'],
  ['ArrowLeft', 'Arrow Left'],
  ['ArrowRight', 'Arrow Right'],
];

function NodeInspector({ node }: { node?: NodeForgeNode }) {
  const updateGraphNodeData = useEditorStore((state) => state.updateGraphNodeData);
  const fireCustomEvent = useEditorStore((state) => state.fireCustomEvent);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  if (!node) {
    return (
      <aside className="graph-inspector">
        <div className="empty-state">
          <MousePointer2 size={18} aria-hidden />
          <span>Select a node</span>
        </div>
      </aside>
    );
  }

  const updatesNodeKey = node.data.nodeKind === 'event.keyDown' || node.data.nodeKind === 'event.keyUp';
  const updatesEventName = node.data.nodeKind === 'event.custom' || node.data.nodeKind === 'action.fireEvent';
  const updatesAxis = node.data.nodeKind === 'action.translate' || node.data.nodeKind === 'action.rotate';
  const eventName = node.data.eventName || 'CustomEvent';

  return (
    <aside className="graph-inspector">
      <div className="graph-inspector-header">
        <span className="eyebrow">Node Inspector</span>
        <h3>{node.data.label}</h3>
      </div>

      <div className="node-inspector-body">
        <label className="node-field">
          <span>Kind</span>
          <input value={node.data.nodeKind} readOnly />
        </label>

        {updatesNodeKey && (
          <label className="node-field">
            <span>Key</span>
            <select
              value={node.data.keyCode ?? 'KeyW'}
              onChange={(event) => updateGraphNodeData(node.id, { keyCode: event.target.value })}
            >
              {keyOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesEventName && (
          <label className="node-field">
            <span>Event Name</span>
            <input
              value={eventName}
              onChange={(event) => updateGraphNodeData(node.id, { eventName: event.target.value })}
            />
          </label>
        )}

        {updatesAxis && (
          <>
            <label className="node-field">
              <span>Axis</span>
              <select
                value={node.data.axis ?? 'z'}
                onChange={(event) => updateGraphNodeData(node.id, { axis: event.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
            </label>
            <label className="node-field">
              <span>{node.data.nodeKind === 'action.rotate' ? 'Degrees / sec' : 'Units / sec'}</span>
              <input
                type="number"
                step="0.1"
                value={node.data.amount ?? (node.data.nodeKind === 'action.rotate' ? 90 : -3.6)}
                onChange={(event) => updateGraphNodeData(node.id, { amount: Number(event.target.value) })}
              />
            </label>
          </>
        )}

        {updatesEventName && (
          <button
            className="fire-event-button"
            onClick={() => fireCustomEvent(eventName)}
            title={isPlaying ? 'Fire custom event now' : 'Start Play mode before firing runtime events'}
            disabled={!isPlaying}
          >
            <Send size={14} aria-hidden />
            <span>Fire Event</span>
          </button>
        )}

        <p className="node-inspector-description">{node.data.description}</p>
      </div>
    </aside>
  );
}

export function VisualScriptingPanel() {
  const graph = useEditorStore((state) => state.activeGraph());
  const blueprints = useEditorStore((state) => state.blueprints);
  const activeBlueprint = useEditorStore((state) => state.activeBlueprint());
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const sceneObjects = useEditorStore(selectActiveObjects);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const createBlueprint = useEditorStore((state) => state.createBlueprint);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const onConnect = useEditorStore((state) => state.onConnect);
  const addGraphNode = useEditorStore((state) => state.addGraphNode);
  const autoLayoutActiveGraph = useEditorStore((state) => state.autoLayoutActiveGraph);
  const selectedGraphNode = useEditorStore((state) => state.selectedGraphNode());
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const instanceCount = sceneObjects.filter((object) => object.script?.blueprintId === activeBlueprintId).length;

  if (!graph || !activeBlueprint) {
    return (
      <section className="panel scripting-panel">
        <div className="empty-state">No Blueprint selected</div>
      </section>
    );
  }

  return (
    <section className="panel scripting-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Reusable Blueprint</span>
          <h2>{activeBlueprint.name}</h2>
        </div>
        <div className="panel-actions graph-actions">
          <span className="blueprint-instances">
            <Boxes size={14} aria-hidden />
            {instanceCount}
          </span>
          <select
            className="blueprint-select"
            value={activeBlueprintId}
            onChange={(event) => setActiveBlueprint(event.target.value)}
            title="Select Blueprint asset"
          >
            {blueprints.map((blueprint) => (
              <option key={blueprint.id} value={blueprint.id}>
                {blueprint.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button compact"
            title="Auto-arrange nodes on a grid"
            onClick={autoLayoutActiveGraph}
          >
            <LayoutGrid size={15} aria-hidden />
          </button>
          <button className="icon-button compact" title="Create reusable Blueprint" onClick={createBlueprint}>
            <Plus size={15} aria-hidden />
          </button>
        </div>
      </div>

      <div className="scripting-body">
        <aside className="node-palette">
          <div className="blueprint-card">
            <strong>{activeBlueprint.name}</strong>
            <span>{activeBlueprint.description}</span>
          </div>
          {nodeGroups.map(({ title, icon: Icon, nodes }) => (
            <section key={title}>
              <h3>
                <Icon size={14} aria-hidden />
                <span>{title}</span>
              </h3>
              <div>
                {nodes.map((node) => (
                  <button key={node} onClick={() => addGraphNode(node, title)} title={`Add ${node}`}>
                    <Plus size={13} aria-hidden />
                    <span>{node}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <div className="flow-shell">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => selectGraphNode(node.id)}
            onPaneClick={() => selectGraphNode(undefined)}
            defaultEdgeOptions={{ animated: true, type: 'smoothstep' }}
            connectionLineStyle={{ stroke: '#5B8CFF', strokeWidth: 2 }}
            snapToGrid
            snapGrid={[24, 24]}
            fitView
          >
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Controls position="bottom-right" />
            <Background color="#30394D" gap={18} size={1} />
          </ReactFlow>
        </div>
        <NodeInspector node={selectedGraphNode} />
      </div>
    </section>
  );
}
