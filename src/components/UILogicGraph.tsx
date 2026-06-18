/**
 * The UI document's behaviour graph, embedded INSIDE the UI editor (not the Scripting panel). It
 * edits the doc's dedicated logic Blueprint with the same real visual-scripting nodes used
 * everywhere (Events, UI, Variables, Logic…). Own ReactFlowProvider so its viewport stays isolated
 * from the Scripting/Material/Animator graphs.
 *
 * `openUILogic` (called on mount) makes the doc's logic blueprint the active blueprint and ensures a
 * tiny "UI Logic" object runs it, so the store's graph actions (onNodesChange/onConnect/
 * addGraphNodeToBlueprint, which target the active blueprint) edit exactly this graph.
 */
import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type NodeTypes } from '@xyflow/react';
import { LayoutGrid, Plus } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { NodeForgeGraphNode } from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import { NodeInspector, nodeGroups, baseNodeChoices } from './VisualScriptingPanel';
import type { GraphNodeCategory, UIDocument } from '../types';

const nodeTypes: NodeTypes = { nodeforge: NodeForgeGraphNode };
const defaultEdgeOptions = { animated: true, type: 'smoothstep' } as const;
const connectionLineStyle = { stroke: '#5B8CFF', strokeWidth: 2 } as const;
const snapGrid: [number, number] = [24, 24];

// The node groups worth showing for UI behaviour (the full palette is overkill here).
const UI_GROUPS = nodeGroups.filter((g) => ['Events', 'UI', 'Variables', 'Logic', 'Math', 'Values'].includes(g.title));

function Flow({ doc }: { doc: UIDocument }) {
  const openUILogic = useEditorStore((state) => state.openUILogic);
  const blueprints = useEditorStore((state) => state.blueprints);
  const graphs = useEditorStore((state) => state.graphs);
  const variables = useEditorStore((state) => state.variables);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const onConnect = useEditorStore((state) => state.onConnect);
  const addGraphNodeToBlueprint = useEditorStore((state) => state.addGraphNodeToBlueprint);
  const createVariable = useEditorStore((state) => state.createVariable);
  const autoLayoutActiveGraph = useEditorStore((state) => state.autoLayoutActiveGraph);
  const selectedGraphNode = useEditorStore((state) => state.selectedGraphNode());
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const { screenToFlowPosition } = useReactFlow();
  const [searchMenu, setSearchMenu] = useState<{ x: number; y: number } | null>(null);

  // Ensure this doc's logic blueprint exists, is active, and is run by a controller object.
  useEffect(() => {
    openUILogic(doc.id);
  }, [doc.id, openUILogic]);

  const blueprintId = doc.logicBlueprintId ?? '';
  const blueprint = blueprints.find((b) => b.id === blueprintId);
  const graph = blueprint ? graphs.find((g) => g.id === blueprint.graphId) : undefined;

  const nodeChoices = useMemo<NodeChoice[]>(
    () => [
      ...baseNodeChoices,
      ...variables.flatMap((variable) => [
        { label: `Get ${variable.name}`, category: 'Variables' as GraphNodeCategory, nodeLabel: 'Get Variable', data: { variableId: variable.id, valueType: variable.type } },
        { label: `Set ${variable.name}`, category: 'Variables' as GraphNodeCategory, nodeLabel: 'Set Variable', data: { variableId: variable.id, valueType: variable.type } },
      ]),
    ],
    [variables],
  );

  const addNode = (label: string, category: GraphNodeCategory, position?: { x: number; y: number }) => {
    if (label === 'New Variable') {
      const variableId = createVariable(undefined, 'number', true);
      selectGraphNode(addGraphNodeToBlueprint(blueprintId, 'Set Variable', 'Variables', { variableId }, position));
      return;
    }
    selectGraphNode(addGraphNodeToBlueprint(blueprintId, label, category, {}, position));
  };

  if (!graph) return <div className="empty-state wide">Preparing logic graph…</div>;

  return (
    <div className="scripting-body">
      <aside className="node-palette">
        <div className="blueprint-card">
          <strong>{doc.name} — Logic</strong>
          <span>Runs via a “UI Logic” object. Wire Show UI / Set UI Text to events.</span>
        </div>
        {UI_GROUPS.map(({ title, icon: Icon, nodes }) => (
          <section key={title}>
            <h3>
              <Icon size={14} aria-hidden />
              <span>{title}</span>
            </h3>
            <div>
              {nodes.map((label) => (
                <button key={label} onClick={() => addNode(label, title)} title={`Add ${label}`}>
                  <Plus size={14} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>

      <div
        className="flow-shell"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          setSearchMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => selectGraphNode(node.id)}
          onPaneClick={() => {
            selectGraphNode(undefined);
            setSearchMenu(null);
          }}
          deleteKeyCode={['Delete', 'Backspace']}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionLineStyle={connectionLineStyle}
          snapToGrid
          snapGrid={snapGrid}
          fitView
        >
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls position="bottom-right" />
          <Background color="#30394D" gap={18} size={1} />
        </ReactFlow>
        <button className="icon-button compact material-autolayout" title="Auto-arrange nodes" onClick={autoLayoutActiveGraph}>
          <LayoutGrid size={14} aria-hidden />
        </button>
      </div>

      <NodeInspector node={selectedGraphNode} />

      {searchMenu && (
        <NodeSearchMenu
          x={searchMenu.x}
          y={searchMenu.y}
          choices={nodeChoices}
          onPick={(choice) => {
            const position = screenToFlowPosition({ x: searchMenu.x, y: searchMenu.y });
            addNode(choice.nodeLabel ?? choice.label, choice.category, position);
            setSearchMenu(null);
          }}
          onClose={() => setSearchMenu(null)}
        />
      )}
    </div>
  );
}

export function UILogicGraph({ doc }: { doc: UIDocument }) {
  return (
    <ReactFlowProvider>
      <Flow doc={doc} />
    </ReactFlowProvider>
  );
}
