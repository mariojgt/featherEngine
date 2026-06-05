import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { LayoutGrid, Plus, Trash2, Workflow } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type {
  AnimatorCondition,
  AnimatorController,
  AnimatorParameter,
  AnimatorTransition,
  CompareOperator,
} from '../types';

const COMPARE_OPS: CompareOperator[] = ['==', '!=', '>', '>=', '<', '<='];
const PARAM_SOURCES: Array<{ value: AnimatorParameter['source']; label: string }> = [
  { value: 'manual', label: 'Manual (scripts/AI)' },
  { value: 'speed', label: 'Object speed' },
  { value: 'verticalSpeed', label: 'Vertical speed' },
  { value: 'moving', label: 'Is moving' },
  { value: 'crouching', label: 'Is crouching' },
  { value: 'grounded', label: 'Is grounded' },
  { value: 'rolling', label: 'Is rolling' },
  { value: 'attacking', label: 'Is attacking' },
  { value: 'aiming', label: 'Is aiming' },
  { value: 'reloading', label: 'Is reloading' },
  { value: 'interacting', label: 'Is interacting' },
  { value: 'emoting', label: 'Is emoting' },
  { value: 'crawling', label: 'Is crawling' },
  { value: 'swimming', label: 'Is swimming' },
  { value: 'climbing', label: 'Is climbing' },
  { value: 'mantling', label: 'Is mantling/vaulting' },
  { value: 'turning', label: 'Is turning in place' },
  { value: 'moveX', label: 'Move X (strafe −1…1)' },
  { value: 'moveY', label: 'Move Y (fwd/back −1…1)' },
  { value: 'weaponEquipped', label: 'Weapon equipped' },
  { value: 'variable', label: 'Project variable' },
];

const ANY_ID = '__any';

// ---- React Flow custom nodes -------------------------------------------------

type StateNodeData = { label: string; clip?: string; isDefault: boolean; isLive: boolean };

/** A state box: name + clip, with an "entry" badge for the default state and a live-play highlight. */
function AnimatorStateNode({ data, selected }: NodeProps<Node<StateNodeData, 'animatorState'>>) {
  return (
    <div className={`animator-node ${selected ? 'selected' : ''} ${data.isLive ? 'live' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} className="node-port" />
      <div className="animator-node-title">
        <strong>{data.label}</strong>
        {data.isDefault && <span className="animator-node-entry">entry</span>}
      </div>
      <span className="animator-node-clip">{data.clip ?? 'no clip'}</span>
      <Handle id="out" type="source" position={Position.Right} className="node-port" />
    </div>
  );
}

/** The "Any State" source — drag from it to a state to make a transition that can fire from anywhere. */
function AnyStateNode() {
  return (
    <div className="animator-node any">
      <span>Any State</span>
      <Handle id="out" type="source" position={Position.Right} className="node-port" />
    </div>
  );
}

const nodeTypes: NodeTypes = { animatorState: AnimatorStateNode, animatorAny: AnyStateNode };

// ---- Parameters (not graph nodes — the inputs the machine reads) -------------

function ParametersEditor({ controller }: { controller: AnimatorController }) {
  const variables = useEditorStore((state) => state.variables);
  const addAnimatorParameter = useEditorStore((state) => state.addAnimatorParameter);
  const updateAnimatorParameter = useEditorStore((state) => state.updateAnimatorParameter);
  const removeAnimatorParameter = useEditorStore((state) => state.removeAnimatorParameter);

  return (
    <section className="inspector-section">
      <div className="animator-section-head">
        <h3>Parameters</h3>
        <button
          className="icon-button compact"
          title="Add parameter"
          onClick={() => addAnimatorParameter(controller.id, { name: `Param ${controller.parameters.length + 1}`, type: 'float' })}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {controller.parameters.length === 0 && <p className="field-hint">Add “Speed” (Float · Object speed) for locomotion.</p>}
      {controller.parameters.map((param) => (
        <div key={param.id} className="animator-row">
          <input className="animator-name" value={param.name} onChange={(event) => updateAnimatorParameter(controller.id, param.id, { name: event.target.value })} />
          <select value={param.type} onChange={(event) => updateAnimatorParameter(controller.id, param.id, { type: event.target.value as AnimatorParameter['type'] })}>
            <option value="float">Float</option>
            <option value="bool">Bool</option>
            <option value="trigger">Trigger</option>
          </select>
          <select value={param.source} onChange={(event) => updateAnimatorParameter(controller.id, param.id, { source: event.target.value as AnimatorParameter['source'] })}>
            {PARAM_SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
          {param.source === 'variable' && (
            <select value={param.variableId ?? ''} onChange={(event) => updateAnimatorParameter(controller.id, param.id, { variableId: event.target.value || undefined })}>
              <option value="">Pick variable…</option>
              {variables.map((variable) => (
                <option key={variable.id} value={variable.id}>
                  {variable.name}
                </option>
              ))}
            </select>
          )}
          <button className="icon-button compact danger" title="Remove" onClick={() => removeAnimatorParameter(controller.id, param.id)}>
            <Trash2 size={13} aria-hidden />
          </button>
        </div>
      ))}
    </section>
  );
}

// ---- Selected-item inspectors ------------------------------------------------

function StateInspector({ controller, stateId }: { controller: AnimatorController; stateId: string }) {
  const animations = useEditorStore((state) => state.animations);
  const updateAnimatorState = useEditorStore((state) => state.updateAnimatorState);
  const updateAnimatorController = useEditorStore((state) => state.updateAnimatorController);
  const removeAnimatorState = useEditorStore((state) => state.removeAnimatorState);
  const state = controller.states.find((s) => s.id === stateId);
  if (!state) return null;
  const clips = controller.skeletonId ? animations.filter((a) => a.skeletonId === controller.skeletonId) : animations;

  return (
    <aside className="graph-inspector">
      <div className="graph-inspector-header">
        <span className="eyebrow">State</span>
        <h3>{state.name}</h3>
      </div>
      <div className="node-inspector-body">
        <label className="field-row">
          <span>Name</span>
          <input value={state.name} onChange={(event) => updateAnimatorState(controller.id, state.id, { name: event.target.value })} />
        </label>
        <label className="field-row">
          <span>Clip</span>
          <select value={state.animationId ?? ''} onChange={(event) => updateAnimatorState(controller.id, state.id, { animationId: event.target.value || undefined })}>
            <option value="">None</option>
            {clips.map((clip) => (
              <option key={clip.id} value={clip.id}>
                {clip.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-row">
          <span>Speed</span>
          <input type="number" step="0.05" value={state.speed} onChange={(event) => updateAnimatorState(controller.id, state.id, { speed: Number(event.target.value) })} />
        </label>
        <label className="field-row">
          <span>Loop</span>
          <input type="checkbox" checked={state.loop} onChange={(event) => updateAnimatorState(controller.id, state.id, { loop: event.target.checked })} />
        </label>

        {/* 1D blend space — blend several clips by a float parameter (Unreal-style smooth locomotion). */}
        {(() => {
          const floatParams = controller.parameters.filter((p) => p.type === 'float');
          const isBlend = Boolean(state.blendSamples?.length);
          const samples = state.blendSamples ?? [];
          const setSamples = (next: typeof samples, paramId?: string) =>
            updateAnimatorState(controller.id, state.id, {
              blendSamples: next.length ? next : undefined,
              blendParameterId: next.length ? paramId ?? state.blendParameterId ?? floatParams[0]?.id : undefined,
            });
          return (
            <>
              <label className="field-row">
                <span>Blend space</span>
                <input
                  type="checkbox"
                  checked={isBlend}
                  disabled={!floatParams.length}
                  onChange={(event) =>
                    event.target.checked
                      ? setSamples([{ animationId: state.animationId ?? clips[0]?.id ?? '', value: 0 }], floatParams[0]?.id)
                      : setSamples([])
                  }
                />
              </label>
              {isBlend && (
                <>
                  <label className="field-row">
                    <span>X axis</span>
                    <select
                      value={state.blendParameterId ?? ''}
                      onChange={(event) => updateAnimatorState(controller.id, state.id, { blendParameterId: event.target.value })}
                    >
                      {floatParams.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-row">
                    <span>Y axis (2D)</span>
                    <select
                      value={state.blendParameterIdY ?? ''}
                      onChange={(event) => updateAnimatorState(controller.id, state.id, { blendParameterIdY: event.target.value || undefined })}
                    >
                      <option value="">None (1D)</option>
                      {floatParams.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="field-hint">Samples — clip @ X{state.blendParameterIdY ? ' , Y' : ''}, blended by the parameter{state.blendParameterIdY ? 's' : ''}.</span>
                  {samples.map((sample, i) => (
                    <div key={i} className="socket-offset" style={{ gridTemplateColumns: state.blendParameterIdY ? '1fr 56px 56px 28px' : '1fr 70px 28px' }}>
                      <select
                        value={sample.animationId}
                        onChange={(event) => setSamples(samples.map((s, j) => (j === i ? { ...s, animationId: event.target.value } : s)))}
                      >
                        {clips.map((clip) => (
                          <option key={clip.id} value={clip.id}>
                            {clip.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step={0.1}
                        title="X"
                        value={sample.value}
                        onChange={(event) => setSamples(samples.map((s, j) => (j === i ? { ...s, value: Number(event.target.value) } : s)))}
                      />
                      {state.blendParameterIdY && (
                        <input
                          type="number"
                          step={0.1}
                          title="Y"
                          value={sample.y ?? 0}
                          onChange={(event) => setSamples(samples.map((s, j) => (j === i ? { ...s, y: Number(event.target.value) } : s)))}
                        />
                      )}
                      <button className="icon-button compact danger" title="Remove sample" onClick={() => setSamples(samples.filter((_, j) => j !== i))}>
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button className="text-button" onClick={() => setSamples([...samples, { animationId: clips[0]?.id ?? '', value: (samples[samples.length - 1]?.value ?? 0) + 1 }])}>
                    + Add sample
                  </button>
                </>
              )}
            </>
          );
        })()}

        <label className="field-row">
          <span>Entry state</span>
          <input type="checkbox" checked={controller.defaultStateId === state.id} onChange={() => updateAnimatorController(controller.id, { defaultStateId: state.id })} />
        </label>
        <button className="full-button" onClick={() => removeAnimatorState(controller.id, state.id)}>
          <Trash2 size={13} aria-hidden /> Delete state
        </button>
      </div>
    </aside>
  );
}

function ConditionRow({ controller, transition, index }: { controller: AnimatorController; transition: AnimatorTransition; index: number }) {
  const updateAnimatorTransition = useEditorStore((state) => state.updateAnimatorTransition);
  const condition = transition.conditions[index];
  const param = controller.parameters.find((p) => p.id === condition.parameterId);
  const isBool = param?.type === 'bool' || param?.type === 'trigger';
  const setConditions = (next: AnimatorCondition[]) => updateAnimatorTransition(controller.id, transition.id, { conditions: next });
  const patch = (changes: Partial<AnimatorCondition>) => setConditions(transition.conditions.map((c, i) => (i === index ? { ...c, ...changes } : c)));

  return (
    <div className="animator-row">
      <select value={condition.parameterId} onChange={(event) => patch({ parameterId: event.target.value })}>
        <option value="">Param…</option>
        {controller.parameters.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={condition.op} onChange={(event) => patch({ op: event.target.value as CompareOperator })}>
        {COMPARE_OPS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {isBool ? (
        <select value={String(condition.value)} onChange={(event) => patch({ value: event.target.value === 'true' })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input type="number" step="0.05" value={Number(condition.value)} onChange={(event) => patch({ value: Number(event.target.value) })} />
      )}
      <button className="icon-button compact danger" title="Remove condition" onClick={() => setConditions(transition.conditions.filter((_, i) => i !== index))}>
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}

function TransitionInspector({ controller, transitionId }: { controller: AnimatorController; transitionId: string }) {
  const updateAnimatorTransition = useEditorStore((state) => state.updateAnimatorTransition);
  const removeAnimatorTransition = useEditorStore((state) => state.removeAnimatorTransition);
  const transition = controller.transitions.find((t) => t.id === transitionId);
  if (!transition) return null;
  const name = (id: string) => (id === 'any' ? 'Any State' : controller.states.find((s) => s.id === id)?.name ?? '—');

  return (
    <aside className="graph-inspector">
      <div className="graph-inspector-header">
        <span className="eyebrow">Transition</span>
        <h3>{name(transition.from)} → {name(transition.to)}</h3>
      </div>
      <div className="node-inspector-body">
        <p className="field-hint">Taken when ALL conditions pass:</p>
        {transition.conditions.map((_, index) => (
          <ConditionRow key={index} controller={controller} transition={transition} index={index} />
        ))}
        <button
          className="full-button"
          onClick={() =>
            updateAnimatorTransition(controller.id, transition.id, {
              conditions: [...transition.conditions, { parameterId: controller.parameters[0]?.id ?? '', op: '>', value: 0 }],
            })
          }
        >
          <Plus size={13} aria-hidden /> Add condition
        </button>
        <label className="field-row">
          <span>Fade (s)</span>
          <input type="number" step="0.05" value={transition.duration} onChange={(event) => updateAnimatorTransition(controller.id, transition.id, { duration: Number(event.target.value) })} />
        </label>
        <label className="field-row">
          <span>Wait for clip</span>
          <input
            type="checkbox"
            checked={Boolean(transition.hasExitTime)}
            onChange={(event) => updateAnimatorTransition(controller.id, transition.id, { hasExitTime: event.target.checked })}
            title="Exit time — only leave after the current clip finishes (use for one-shots like Jump Start/Land)"
          />
        </label>
        <button className="full-button" onClick={() => removeAnimatorTransition(controller.id, transition.id)}>
          <Trash2 size={13} aria-hidden /> Delete transition
        </button>
      </div>
    </aside>
  );
}

// ---- The graph ----------------------------------------------------------------

/**
 * Tidy left→right layered layout for an animator's states: BFS from the default (entry) state along
 * transitions assigns a column by reachable depth; states in the same column stack into rows. Unreachable
 * states (only entered via "Any State") land in a trailing column. Returns a {stateId: {x,y}} map.
 */
function computeAnimatorLayout(controller: AnimatorController): Record<string, { x: number; y: number }> {
  const COL = 260;
  const ROW = 140;
  const ids = controller.states.map((s) => s.id);
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const t of controller.transitions) {
    if (t.from === 'any' || !adj.has(t.from) || !idSet.has(t.to)) continue;
    adj.get(t.from)!.push(t.to);
  }
  const depth = new Map<string, number>();
  const root = controller.defaultStateId && idSet.has(controller.defaultStateId) ? controller.defaultStateId : ids[0];
  const queue: string[] = [];
  if (root) {
    depth.set(root, 0);
    queue.push(root);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(cur) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  let maxDepth = 0;
  depth.forEach((d) => (maxDepth = Math.max(maxDepth, d)));
  for (const id of ids) if (!depth.has(id)) depth.set(id, maxDepth + 1); // unreachable → trailing column
  const byCol = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    if (!byCol.has(d)) byCol.set(d, []);
    byCol.get(d)!.push(id);
  }
  const out: Record<string, { x: number; y: number }> = {};
  for (const [col, list] of byCol) list.forEach((id, row) => (out[id] = { x: 40 + col * COL, y: 40 + row * ROW }));
  return out;
}

function AnimatorFlow({ controller }: { controller: AnimatorController }) {
  const addAnimatorState = useEditorStore((state) => state.addAnimatorState);
  const addAnimatorTransition = useEditorStore((state) => state.addAnimatorTransition);
  const updateAnimatorState = useEditorStore((state) => state.updateAnimatorState);
  const removeAnimatorState = useEditorStore((state) => state.removeAnimatorState);
  const removeAnimatorTransition = useEditorStore((state) => state.removeAnimatorTransition);
  const runtimeAnimators = useEditorStore((state) => state.runtimeAnimators);
  const animations = useEditorStore((state) => state.animations);
  const objects = useEditorStore(selectActiveObjects);

  const [selected, setSelected] = useState<{ kind: 'state' | 'transition'; id: string } | null>(null);

  // The live (Play) state for any object currently driven by this controller.
  const liveStateId = useMemo(() => {
    const owner = objects.find((object) => object.animator?.controllerId === controller.id && runtimeAnimators[object.id]);
    return owner ? runtimeAnimators[owner.id]?.stateId : undefined;
  }, [objects, runtimeAnimators, controller.id]);

  const condLabel = (t: AnimatorTransition) => {
    if (!t.conditions.length) return '—';
    const text = t.conditions
      .map((c) => {
        const p = controller.parameters.find((pp) => pp.id === c.parameterId);
        return `${p?.name ?? '?'} ${c.op} ${c.value}`;
      })
      .join(' & ');
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
  };

  const buildNodes = (): Node[] => {
    const stateNodes: Node[] = controller.states.map((state, index) => ({
      id: state.id,
      type: 'animatorState',
      position: state.position ?? { x: 80 + (index % 3) * 220, y: 40 + Math.floor(index / 3) * 130 },
      data: {
        label: state.name,
        clip: state.animationId ? animations.find((a) => a.id === state.animationId)?.name : undefined,
        isDefault: controller.defaultStateId === state.id,
        isLive: liveStateId === state.id,
      } satisfies StateNodeData,
    }));
    stateNodes.push({ id: ANY_ID, type: 'animatorAny', position: { x: -180, y: 20 }, data: {}, deletable: false });
    return stateNodes;
  };

  const buildEdges = (): Edge[] =>
    controller.transitions.map((t) => ({
      id: t.id,
      source: t.from === 'any' ? ANY_ID : t.from,
      target: t.to,
      sourceHandle: 'out',
      targetHandle: 'in',
      label: condLabel(t),
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: true,
    }));

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());

  // Re-seed from the store when the machine's *structure* changes (not on every drag).
  const statesKey = controller.states.map((s) => `${s.id}:${s.name}:${s.animationId ?? ''}`).join('|') + `#${controller.defaultStateId ?? ''}#${liveStateId ?? ''}`;
  const edgesKey = controller.transitions.map((t) => `${t.id}:${t.from}>${t.to}:${t.conditions.length}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setNodes(buildNodes()), [statesKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdges(buildEdges()), [edgesKey]);

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.target === ANY_ID) return;
    addAnimatorTransition(controller.id, { from: connection.source === ANY_ID ? 'any' : connection.source, to: connection.target });
  };

  // Auto-arrange: tidy left→right layered layout of the states; persists positions + updates the live graph.
  const autoArrange = () => {
    const layout = computeAnimatorLayout(controller);
    for (const [id, position] of Object.entries(layout)) updateAnimatorState(controller.id, id, { position });
    setNodes((current) => current.map((node) => (layout[node.id] ? { ...node, position: layout[node.id] } : node)));
  };

  return (
    <div className="scripting-body">
      <aside className="node-palette">
        <div className="blueprint-card">
          <strong>{controller.name}</strong>
          <span>Drag between states to add transitions. Drag from “Any State” for global ones.</span>
        </div>
        <button className="full-button" onClick={() => { const id = addAnimatorState(controller.id); if (id) setSelected({ kind: 'state', id }); }}>
          <Plus size={14} aria-hidden /> Add State
        </button>
        <button className="full-button" onClick={autoArrange} title="Tidy the state graph into a left→right layered layout">
          <LayoutGrid size={14} aria-hidden /> Auto Arrange
        </button>
        <ParametersEditor controller={controller} />
      </aside>

      <div className="flow-shell">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={(_, node) => {
            if (node.id !== ANY_ID) updateAnimatorState(controller.id, node.id, { position: node.position });
          }}
          onNodeClick={(_, node) => setSelected(node.id === ANY_ID ? null : { kind: 'state', id: node.id })}
          onEdgeClick={(_, edge) => setSelected({ kind: 'transition', id: edge.id })}
          onNodesDelete={(deleted) => deleted.forEach((node) => node.id !== ANY_ID && removeAnimatorState(controller.id, node.id))}
          onEdgesDelete={(deleted) => deleted.forEach((edge) => removeAnimatorTransition(controller.id, edge.id))}
          onPaneClick={() => setSelected(null)}
          deleteKeyCode={['Delete', 'Backspace']}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          fitView
        >
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls position="bottom-right" />
          <Background color="#30394D" gap={18} size={1} />
        </ReactFlow>
      </div>

      {selected?.kind === 'state' && <StateInspector controller={controller} stateId={selected.id} />}
      {selected?.kind === 'transition' && <TransitionInspector controller={controller} transitionId={selected.id} />}
    </div>
  );
}

export function AnimatorEditorPanel() {
  const controllers = useEditorStore((state) => state.animatorControllers);
  const activeAnimatorControllerId = useEditorStore((state) => state.activeAnimatorControllerId);
  const setActiveAnimatorController = useEditorStore((state) => state.setActiveAnimatorController);
  const createAnimatorController = useEditorStore((state) => state.createAnimatorController);
  const updateAnimatorController = useEditorStore((state) => state.updateAnimatorController);

  const controller = controllers.find((item) => item.id === activeAnimatorControllerId) ?? controllers[0];

  return (
    <section className="panel scripting-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Animation</span>
          <h2>Animator</h2>
        </div>
        {controllers.length > 0 && controller && (
          <input
            className="name-input"
            value={controller.name}
            onChange={(event) => updateAnimatorController(controller.id, { name: event.target.value })}
            title="Controller name"
          />
        )}
        {controllers.length > 0 && (
          <select className="blueprint-select" value={controller?.id ?? ''} onChange={(event) => setActiveAnimatorController(event.target.value)} title="Select controller">
            {controllers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create controller" onClick={() => createAnimatorController()}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {!controller ? (
        <div className="empty-state wide">
          <Workflow size={18} aria-hidden />
          <span>No animator controller yet</span>
          <button className="full-button" onClick={() => createAnimatorController()}>
            Create Controller
          </button>
        </div>
      ) : (
        // Own ReactFlowProvider so this graph's viewport stays isolated from the other node editors.
        <ReactFlowProvider>
          <AnimatorFlow key={controller.id} controller={controller} />
        </ReactFlowProvider>
      )}
    </section>
  );
}
