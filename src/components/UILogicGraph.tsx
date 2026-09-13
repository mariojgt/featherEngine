import { scanInteractionProblems } from '../ui/interactionProblems';
import { scanBlueprintGraphProblems } from '../store/editor/graphDiagnostics';
import { revealInteractionProblem } from './interactionNavigation';
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
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { NodeForgeGraphNode } from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import { NodeInspector, nodeGroups, baseNodeChoices } from './VisualScriptingPanel';
import type { GraphNodeCategory, UIDocument } from '../types';

const nodeTypes: NodeTypes = { nodeforge: NodeForgeGraphNode };
const defaultEdgeOptions = { animated: true, type: 'smoothstep' } as const;
const connectionLineStyle = { stroke: '#5B8CFF', strokeWidth: 2 } as const;
const snapGrid: [number, number] = [24, 24];

// The node groups worth showing for UI behaviour (the full palette is overkill here).
const UI_GROUPS = nodeGroups.filter((g) => ['Events', 'UI', 'Variables', 'Logic', 'Math', 'Values', 'Runtime'].includes(g.title));

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
  const selectedId = useEditorStore(state => state.selectedGraphNodeId);
  const activeBlueprintId = useEditorStore(state => state.activeBlueprintId);
  const setActiveBlueprint = useEditorStore(state => state.setActiveBlueprint);
  const scenes = useEditorStore(state => state.isPlaying ? null : state.scenes);
  const objects = useEditorStore(state => state.isPlaying ? null : selectActiveObjects(state));
  const documents = useEditorStore(state => state.uiDocuments);
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [searchMenu, setSearchMenu] = useState<{ x: number; y: number } | null>(null);

  // Ensure this doc's logic blueprint exists, is active, and is run by a controller object.
  useEffect(() => {
    openUILogic(doc.id);
  }, [doc.id, openUILogic]);

  const blueprintId = doc.logicBlueprintId ?? '';
  const blueprint = blueprints.find((b) => b.id === blueprintId);
  const graph = blueprint ? graphs.find((g) => g.id === blueprint.graphId) : undefined;

  const selectedGraphNode = graph?.nodes.find(n => n.id === selectedId);
  const activate = () => { if (useEditorStore.getState().activeBlueprintId !== blueprintId) setActiveBlueprint(blueprintId); };
  useEffect(() => {
    if (!selectedId || !graph?.nodes.some(n => n.id === selectedId)) return;
    const following = new Set([selectedId, ...(graph?.edges.filter(e => e.source === selectedId).map(e => e.target) ?? [])]);
    const timer = window.setTimeout(() => { void fitView({ nodes: [...following].map(id => ({ id })), padding: .35, maxZoom: 1, duration: 220 }); }, 100);
    return () => window.clearTimeout(timer);
  }, [selectedId, graph?.id, fitView]);
  const problems = useMemo(() => !objects || !scenes || !blueprint || !graph ? [] : [
    ...scanInteractionProblems(objects, graphs, blueprints, documents, scenes).filter(p => p.blueprintId === blueprintId || p.uiDocumentId === doc.id),
    ...scanBlueprintGraphProblems(blueprint, graph, variables).map(p => ({ ...p, uiDocumentId: doc.id })),
  ], [objects, scenes, blueprint, graph, graphs, blueprints, documents, blueprintId, doc.id, variables]);

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
    <div className="scripting-body" onPointerDownCapture={activate} onFocusCapture={activate}>
      <aside className="node-palette">
        <div className="blueprint-card">
          <strong>{doc.name} — Logic</strong>
          <span>
            Each button starts at a Custom Event. Follow the execution wires to see what happens next.
            Select a node to change its settings, or return to Design to choose a button action.
          </span>
        </div>
        {problems.length > 0 && <div className="interaction-guidance" aria-label="Logic guidance"><strong>{problems.length} things to check</strong>{problems.map((p, i) => <button key={i} onClick={() => revealInteractionProblem(p)}>{p.message}</button>)}</div>}
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
          nodes={graph.nodes.map(n => n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId })}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={changes => { if (activeBlueprintId === blueprintId) onNodesChange(changes); }}
          onEdgesChange={changes => { if (activeBlueprintId === blueprintId) onEdgesChange(changes); }}
          onConnect={connection => { activate(); onConnect(connection); }}
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
        <button className="icon-button compact material-autolayout" title="Auto-arrange nodes" onClick={() => { activate(); autoLayoutActiveGraph(); }}>
          <LayoutGrid size={14} aria-hidden />
        </button>
      </div>

      <NodeInspector node={activeBlueprintId === blueprintId ? selectedGraphNode : undefined} />

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
