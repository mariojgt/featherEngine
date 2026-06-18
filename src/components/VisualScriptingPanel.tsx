import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useReactFlow, type Connection, type Edge, type NodeTypes } from '@xyflow/react';
import { Boxes, Database, GitBranch, LayoutDashboard, LayoutGrid, MousePointer2, Plus, Save, Search, Send, Sigma, Table2, Trash2, Waypoints, Zap } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useSceneOptions, useStableActiveObjects, useStableActiveScene } from '../store/stableSelectors';
import { nodeDescriptions, nodeKindByLabel } from '../store/editor/graph';
import { NodeForgeGraphNode, outputTypeOf, VALUE_TYPE_COLORS, EXEC_WIRE_COLOR } from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import { PaletteGroup } from './PaletteGroup';
import type { GraphNodeCategory, GraphNodeKind, GraphValue, GraphValueType, NodeForgeNode, NodeForgeNodeData, QualityLevel, UIElement, Vector3Tuple } from '../types';
import { QUALITY_LEVELS } from '../three/quality';
import { KEY_CODE_OPTIONS, keyLabelByCode } from '../utils/keyboardCodes';
import { execTrace, setExecTraceEnabled } from '../runtime/execTrace';

const nodeTypes: NodeTypes = {
  nodeforge: NodeForgeGraphNode,
};

const defaultEdgeOptions = { animated: true, type: 'smoothstep' } as const;
const connectionLineStyle = { stroke: '#5B8CFF', strokeWidth: 2 } as const;
const snapGrid: [number, number] = [24, 24];

export const nodeGroups: Array<{
  title: GraphNodeCategory;
  icon: typeof Zap;
  nodes: string[];
}> = [
  {
    title: 'Events',
    icon: Zap,
    nodes: ['Start', 'Update', 'Key Down', 'Key Up', 'Custom Event', 'Collision Enter', 'Collision Exit', 'Trigger Enter', 'Trigger Exit', 'Interact', 'On Receive Damage', 'Timer'],
  },
  {
    title: 'Logic',
    icon: GitBranch,
    nodes: ['Branch', 'Switch', 'Sequence', 'Flip Flop', 'Select', 'Compare', 'AND', 'OR', 'NOT', 'Cast', 'Cooldown', 'Do Once', 'Delay', 'For Loop', 'For Each Actor', 'Function', 'Call Function', 'Return', 'Comment'],
  },
  {
    title: 'Math',
    icon: Sigma,
    nodes: [
      'Add',
      'Subtract',
      'Multiply',
      'Divide',
      'Modulo',
      'Clamp',
      'Lerp',
      'Abs',
      'Min',
      'Max',
      'Round',
      'Power',
      'Sin',
      'Cos',
      'Distance',
      'Add Vectors',
      'Subtract Vectors',
      'Scale Vector',
      'Normalize',
      'Make Vector3',
    ],
  },
  {
    title: 'Values',
    icon: Database,
    nodes: ['Number', 'Random', 'String', 'Boolean', 'Vector3', 'Append'],
  },
  {
    title: 'Variables',
    icon: Database,
    nodes: ['New Variable', 'Get Variable', 'Set Variable', 'Get Object Var', 'Set Object Var'],
  },
  {
    title: 'Data',
    icon: Table2,
    nodes: ['Data Asset Lookup'],
  },
  {
    title: 'Runtime',
    icon: Waypoints,
    nodes: ['Translate', 'Rotate', 'Get Position', 'Set Position', 'Get Rotation', 'Set Rotation', 'Get Scale', 'Set Scale', 'Tween', 'Look At', 'Get Move Input', 'Move', 'Move To', 'Jump', 'Get Drive Input', 'Drive', 'Enter Vehicle', 'Exit Vehicle', 'Get Vehicle Speed', 'Is Grounded', 'Raycast', 'Set Camera', 'Set Ragdoll', 'Spawn Projectile', 'Spawn Attached', 'Set Visible', 'Set Active', 'Burst Particles', 'Set Particles Emitting', 'Spawn Particle System', 'Camera Shake', 'Explode', 'Set Environment', 'Apply Damage', 'Set Quality', 'Set Time Scale', 'Fire Event', 'Play Cinematic', 'Spawn Object', 'Load Scene', 'Destroy Object', 'Play Sound', 'Set Material Color', 'Set Material Property', 'Get Material Color', 'Get Material Property', 'Set Anim Float', 'Set Anim Bool', 'Set Anim Trigger', 'Play Animation', 'Set Movement Mode', 'Get Anim Param', 'Get Anim State', 'Find Actor By Blueprint', 'Find Actor By Tag', 'Distance To Player', 'Direction To Player', 'Player Location', 'Face Player', 'Print'],
  },
  {
    title: 'Physics',
    icon: Boxes,
    nodes: ['Apply Force', 'Apply Impulse', 'Apply Torque', 'Set Physics', 'Set Velocity', 'Get Velocity', 'Overlap Sphere', 'Cut Cable', 'Set Cable Length', 'Get Cable Tension', 'Fracture'],
  },
  {
    title: 'Persistence',
    icon: Save,
    nodes: ['Save Game', 'Load Game', 'Clear Save', 'Has Save'],
  },
  {
    title: 'UI',
    icon: LayoutDashboard,
    nodes: ['Show UI', 'Hide UI', 'Set UI Text'],
  },
];

export const baseNodeChoices: NodeChoice[] = nodeGroups.flatMap((group) =>
  group.nodes.map((label) => {
    const nodeKind = nodeKindByLabel[label];
    return {
      label,
      category: group.title,
      description: nodeDescriptions[label],
      nodeKind,
      valueType: nodeKind ? outputTypeOf[nodeKind] ?? 'exec' : 'exec',
    };
  }),
);

const spawnKinds: Array<['cube' | 'sphere' | 'capsule' | 'plane', string]> = [
  ['cube', 'Cube'],
  ['sphere', 'Sphere'],
  ['capsule', 'Capsule'],
  ['plane', 'Plane'],
];

const valueTypes: GraphValueType[] = ['number', 'string', 'boolean', 'vector3'];
const compareOps = ['==', '!=', '>', '>=', '<', '<='] as const;
type EnvPatchKey = keyof NonNullable<NodeForgeNodeData['envPatch']>;
const environmentFields: Array<{ key: EnvPatchKey; label: string; type: 'color' | 'number' | 'boolean' | 'vector'; step?: number; min?: number }> = [
  { key: 'skyTopColor', label: 'Sky Top', type: 'color' },
  { key: 'skyHorizonColor', label: 'Sky Horizon', type: 'color' },
  { key: 'skyGroundColor', label: 'Sky Ground', type: 'color' },
  { key: 'fogEnabled', label: 'Fog', type: 'boolean' },
  { key: 'fogColor', label: 'Fog Color', type: 'color' },
  { key: 'fogNear', label: 'Fog Near', type: 'number', step: 1, min: 0 },
  { key: 'fogFar', label: 'Fog Far', type: 'number', step: 1, min: 1 },
  { key: 'sunColor', label: 'Sun Color', type: 'color' },
  { key: 'sunIntensity', label: 'Sun Intensity', type: 'number', step: 0.05, min: 0 },
  { key: 'sunAzimuth', label: 'Sun Azimuth', type: 'number', step: 1 },
  { key: 'sunElevation', label: 'Sun Elevation', type: 'number', step: 1 },
  { key: 'environmentIntensity', label: 'Environment Intensity', type: 'number', step: 0.05, min: 0 },
  { key: 'wind', label: 'Wind', type: 'vector', step: 0.5 },
  { key: 'windTurbulence', label: 'Wind Turbulence', type: 'number', step: 0.05, min: 0 },
];

const emptyValue = (type: GraphValueType): GraphValue => {
  if (type === 'number') return 0;
  if (type === 'string') return '';
  if (type === 'boolean') return false;
  return [0, 0, 0];
};

/** Flatten a UI element tree into a depth-prefixed list for the Set UI Text element picker. */
const flattenUIElements = (root: UIElement, depth = 0): Array<{ id: string; label: string }> => [
  { id: root.id, label: `${'— '.repeat(depth)}${root.name} (${root.kind})` },
  ...root.children.flatMap((child) => flattenUIElements(child, depth + 1)),
];

const graphValueFromNode = (node: NodeForgeNode, type: GraphValueType): GraphValue => {
  if (type === 'number') return Number(node.data.numberValue ?? node.data.amount ?? 0);
  if (type === 'string') return node.data.stringValue ?? node.data.message ?? '';
  if (type === 'boolean') return Boolean(node.data.booleanValue);
  return node.data.vectorValue ?? [0, 0, 0];
};

const graphValuePatch = (type: GraphValueType, value: GraphValue): Partial<NodeForgeNode['data']> => {
  if (type === 'number') return { valueType: type, numberValue: Number(value) };
  if (type === 'string') return { valueType: type, stringValue: String(value) };
  if (type === 'boolean') return { valueType: type, booleanValue: Boolean(value) };
  return { valueType: type, vectorValue: (Array.isArray(value) ? value : [0, 0, 0]) as Vector3Tuple };
};

function ValueEditor({
  type,
  value,
  onChange,
}: {
  type: GraphValueType;
  value: GraphValue | undefined;
  onChange: (value: GraphValue) => void;
}) {
  if (type === 'number') {
    return (
      <input
        type="number"
        step="0.1"
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <select value={value ? 'true' : 'false'} onChange={(event) => onChange(event.target.value === 'true')}>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (type === 'vector3') {
    const vector = Array.isArray(value) ? value : ([0, 0, 0] as Vector3Tuple);
    return (
      <div className="node-vector-field">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}>
            <span>{axis}</span>
            <input
              type="number"
              step="0.1"
              value={vector[index]}
              onChange={(event) => {
                const next = [...vector] as Vector3Tuple;
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    );
  }

  return <input value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
}

function GraphDataLibrary() {
  const variables = useEditorStore((state) => state.variables);
  const dataAssets = useEditorStore((state) => state.dataAssets);
  const createVariable = useEditorStore((state) => state.createVariable);
  const updateVariable = useEditorStore((state) => state.updateVariable);
  const deleteVariable = useEditorStore((state) => state.deleteVariable);
  const blueprints = useEditorStore((state) => state.blueprints);
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const addBlueprintVariable = useEditorStore((state) => state.addBlueprintVariable);
  const updateBlueprintVariable = useEditorStore((state) => state.updateBlueprintVariable);
  const removeBlueprintVariable = useEditorStore((state) => state.removeBlueprintVariable);
  const activeBlueprint = blueprints.find((b) => b.id === activeBlueprintId);
  const instanceVars = activeBlueprint?.variables ?? [];
  const createDataAsset = useEditorStore((state) => state.createDataAsset);
  const renameDataAsset = useEditorStore((state) => state.renameDataAsset);
  const deleteDataAsset = useEditorStore((state) => state.deleteDataAsset);
  const addDataAssetColumn = useEditorStore((state) => state.addDataAssetColumn);
  const updateDataAssetColumn = useEditorStore((state) => state.updateDataAssetColumn);
  const deleteDataAssetColumn = useEditorStore((state) => state.deleteDataAssetColumn);
  const addDataAssetRow = useEditorStore((state) => state.addDataAssetRow);
  const updateDataAssetRow = useEditorStore((state) => state.updateDataAssetRow);
  const deleteDataAssetRow = useEditorStore((state) => state.deleteDataAssetRow);
  const setDataAssetCell = useEditorStore((state) => state.setDataAssetCell);

  return (
    <div className="graph-library">
      <section>
        <div className="library-heading">
          <span>Global Variables</span>
          <button title="Create a global (shared) variable" onClick={() => createVariable()}>
            <Plus size={14} aria-hidden />
          </button>
        </div>
        <small className="node-hint">
          SHARED across the whole game (one value for everything) — use for score, settings, Save Game. For per-object
          state (per-player gold, per-enemy health) use Instance Variables below instead.
        </small>

        {variables.map((variable) => (
          <div className="library-card" key={variable.id}>
            <div className="library-row">
              <input value={variable.name} onChange={(event) => updateVariable(variable.id, { name: event.target.value })} />
              <button title="Delete variable" onClick={() => deleteVariable(variable.id)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            <div className="library-row two">
              <select
                value={variable.type}
                onChange={(event) =>
                  updateVariable(variable.id, {
                    type: event.target.value as GraphValueType,
                    defaultValue: emptyValue(event.target.value as GraphValueType),
                  })
                }
              >
                {valueTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="library-check" title="Include this variable in Save Game nodes">
                <input
                  type="checkbox"
                  checked={variable.persistent}
                  onChange={(event) => updateVariable(variable.id, { persistent: event.target.checked })}
                />
                <span>Save</span>
              </label>
            </div>
            <ValueEditor
              type={variable.type}
              value={variable.defaultValue}
              onChange={(defaultValue) => updateVariable(variable.id, { defaultValue })}
            />
          </div>
        ))}
      </section>

      <section>
        <div className="library-heading">
          <span>Instance Variables{activeBlueprint ? ` · ${activeBlueprint.name}` : ''}</span>
          <button
            title={activeBlueprint ? 'Declare a per-instance variable on this blueprint' : 'Open a blueprint first'}
            disabled={!activeBlueprint}
            onClick={() => activeBlueprint && addBlueprintVariable(activeBlueprint.id)}
          >
            <Plus size={14} aria-hidden />
          </button>
        </div>
        {!activeBlueprint && <small className="node-hint">Open a blueprint to declare its per-instance variables.</small>}
        {activeBlueprint && instanceVars.length === 0 && (
          <small className="node-hint">
            Each object running this blueprint gets its OWN copy (e.g. per-player Gold). Read/write with Get/Set Object Var (key = the name).
          </small>
        )}
        {activeBlueprint &&
          instanceVars.map((variable) => (
            <div className="library-card" key={variable.id}>
              <div className="library-row">
                <input
                  value={variable.name}
                  onChange={(event) => updateBlueprintVariable(activeBlueprint.id, variable.id, { name: event.target.value })}
                />
                <button title="Delete instance variable" onClick={() => removeBlueprintVariable(activeBlueprint.id, variable.id)}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <div className="library-row two">
                <select
                  value={variable.type}
                  onChange={(event) =>
                    updateBlueprintVariable(activeBlueprint.id, variable.id, {
                      type: event.target.value as GraphValueType,
                      defaultValue: emptyValue(event.target.value as GraphValueType),
                    })
                  }
                >
                  {valueTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <ValueEditor
                type={variable.type}
                value={variable.defaultValue}
                onChange={(defaultValue) => updateBlueprintVariable(activeBlueprint.id, variable.id, { defaultValue })}
              />
            </div>
          ))}
      </section>

      <section>
        <div className="library-heading">
          <span>Data Assets</span>
          <button title="Create Data Asset" onClick={() => createDataAsset()}>
            <Plus size={14} aria-hidden />
          </button>
        </div>

        {dataAssets.map((table) => (
          <div className="library-card data-table-card" key={table.id}>
            <div className="library-row">
              <input value={table.name} onChange={(event) => renameDataAsset(table.id, event.target.value)} />
              <button title="Delete Data Asset" onClick={() => deleteDataAsset(table.id)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>

            <div className="table-tools">
              <button onClick={() => addDataAssetColumn(table.id)} title="Add column">
                <Plus size={12} aria-hidden />
                <span>Column</span>
              </button>
              <button onClick={() => addDataAssetRow(table.id)} title="Add row">
                <Plus size={12} aria-hidden />
                <span>Row</span>
              </button>
            </div>

            <div className="table-columns">
              {table.columns.map((column) => (
                <div key={column.id} className="table-column-editor">
                  <input
                    value={column.name}
                    onChange={(event) => updateDataAssetColumn(table.id, column.id, { name: event.target.value })}
                  />
                  <select
                    value={column.type}
                    onChange={(event) =>
                      updateDataAssetColumn(table.id, column.id, { type: event.target.value as GraphValueType })
                    }
                  >
                    {valueTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <button title="Delete column" onClick={() => deleteDataAssetColumn(table.id, column.id)}>
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              ))}
            </div>

            <div className="table-rows">
              {table.rows.map((row) => (
                <div key={row.id} className="table-row-editor">
                  <div className="library-row">
                    <input value={row.key} onChange={(event) => updateDataAssetRow(table.id, row.id, { key: event.target.value })} />
                    <button title="Delete row" onClick={() => deleteDataAssetRow(table.id, row.id)}>
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                  {table.columns.map((column) => (
                    <label key={column.id} className="table-cell-editor">
                      <span>{column.name}</span>
                      <ValueEditor
                        type={column.type}
                        value={row.values[column.id]}
                        onChange={(value) => setDataAssetCell(table.id, row.id, column.id, value)}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export function NodeInspector({ node }: { node?: NodeForgeNode }) {
  const updateGraphNodeData = useEditorStore((state) => state.updateGraphNodeData);
  const fireCustomEvent = useEditorStore((state) => state.fireCustomEvent);
  const deleteGraphNode = useEditorStore((state) => state.deleteGraphNode);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const assets = useEditorStore((state) => state.assets);
  const audioAssets = useMemo(() => assets.filter((asset) => asset.type === 'audio'), [assets]);
  const variables = useEditorStore((state) => state.variables);
  const dataAssets = useEditorStore((state) => state.dataAssets);
  const animatorControllers = useEditorStore((state) => state.animatorControllers);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const blueprints = useEditorStore((state) => state.blueprints);
  const activeGraph = useEditorStore((state) => state.activeGraph());
  // Stable subscriptions: the raw scene/scenes/objects references are replaced EVERY Play tick, which
  // re-rendered this whole xyflow graph 60×/s — the single biggest panel cost in the perf profiler.
  const activeScene = useStableActiveScene();
  const scenes = useSceneOptions();
  const sceneObjects = useStableActiveObjects();
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const isAnimNode = Boolean(node?.data.nodeKind.startsWith('animator.'));

  // Objects that actually have an animator controller — the choices for a Set/Get Anim node's Target.
  const animObjects = useMemo(
    () =>
      sceneObjects
        .filter((o) => o.animator?.controllerId)
        .map((o) => ({ id: o.id, name: o.name, controllerName: animatorControllers.find((c) => c.id === o.animator?.controllerId)?.name })),
    [sceneObjects, animatorControllers],
  );
  // The single controller this node reads from: the Target object's, or — for "self" — the owner's
  // (the object this blueprint is attached to). Strictly one controller, so multiple animators never mix.
  const targetController = useMemo(() => {
    const controllerOf = (objId?: string) => sceneObjects.find((o) => o.id === objId)?.animator?.controllerId;
    const id = node?.data.targetObjectId
      ? controllerOf(node.data.targetObjectId)
      : controllerOf(sceneObjects.find((o) => o.script?.blueprintId === activeBlueprintId)?.id);
    return animatorControllers.find((c) => c.id === id);
  }, [animatorControllers, sceneObjects, activeBlueprintId, node?.data.targetObjectId]);
  const animParams = targetController?.parameters ?? [];

  if (!node) {
    return (
      <aside className="graph-inspector">
        <div className="empty-state compact">
          <MousePointer2 size={18} aria-hidden />
          <span>Select a node</span>
        </div>
        <GraphDataLibrary />
      </aside>
    );
  }

  const updatesNodeKey = node.data.nodeKind === 'event.keyDown' || node.data.nodeKind === 'event.keyUp';
  const updatesEventName = node.data.nodeKind === 'event.custom' || node.data.nodeKind === 'action.fireEvent';
  const updatesFunctionName = node.data.nodeKind === 'event.functionEntry' || node.data.nodeKind === 'logic.callFunction';
  const isComment = node.data.nodeKind === 'comment.note';
  const isSwitch = node.data.nodeKind === 'logic.switch';
  const isRound = node.data.nodeKind === 'math.round';
  const updatesAxis =
    node.data.nodeKind === 'action.translate' ||
    node.data.nodeKind === 'action.rotate' ||
    node.data.nodeKind === 'action.applyForce' ||
    node.data.nodeKind === 'action.applyImpulse';
  const updatesImpulseSpace = node.data.nodeKind === 'action.applyImpulse';
  const updatesSound = node.data.nodeKind === 'action.playSound';
  const updatesCinematic = node.data.nodeKind === 'action.playCinematic';
  const updatesParticleSystem = node.data.nodeKind === 'action.spawnParticleSystem';
  const updatesSpawn = node.data.nodeKind === 'action.spawnObject';
  const updatesProjectile = node.data.nodeKind === 'action.spawnProjectile';
  const updatesMessage = node.data.nodeKind === 'action.print';
  const updatesVariable = node.data.nodeKind === 'variable.get' || node.data.nodeKind === 'variable.set';
  const updatesDataAsset = node.data.nodeKind === 'data.tableGet';
  const updatesCompare = node.data.nodeKind === 'logic.compare';
  const updatesBooleanValue =
    node.data.nodeKind === 'value.boolean' ||
    node.data.nodeKind === 'logic.branch' ||
    node.data.nodeKind === 'animator.setBool' ||
    node.data.nodeKind === 'action.setParticlesEmitting' ||
    node.data.nodeKind === 'action.setActive';
  const updatesNumberValue =
    node.data.nodeKind === 'value.number' ||
    node.data.nodeKind === 'math.add' ||
    node.data.nodeKind === 'math.clamp' ||
    node.data.nodeKind === 'math.lerp' ||
    node.data.nodeKind === 'logic.compare' ||
    node.data.nodeKind === 'animator.setFloat' ||
    node.data.nodeKind === 'action.burstParticles' ||
    node.data.nodeKind === 'event.update' ||
    node.data.nodeKind === 'event.timer' ||
    node.data.nodeKind === 'logic.cooldown' ||
    node.data.nodeKind === 'logic.delay' ||
    node.data.nodeKind === 'action.setTimeScale';
  const updatesParamName =
    node.data.nodeKind === 'animator.setFloat' ||
    node.data.nodeKind === 'animator.setBool' ||
    node.data.nodeKind === 'animator.setTrigger' ||
    node.data.nodeKind === 'animator.getParam';
  const updatesStringValue = node.data.nodeKind === 'value.string';
  const updatesVectorValue = node.data.nodeKind === 'value.vector3' || node.data.nodeKind === 'action.spawnParticleSystem';
  const updatesSaveSlot =
    node.data.nodeKind === 'save.write' ||
    node.data.nodeKind === 'save.load' ||
    node.data.nodeKind === 'save.clear' ||
    node.data.nodeKind === 'save.has';
  const updatesMaterialColor = node.data.nodeKind === 'action.setMaterialColor';
  const updatesMaterialProperty =
    node.data.nodeKind === 'action.setMaterialProperty' || node.data.nodeKind === 'action.getMaterialProperty';
  const updatesMaterialColorTarget = node.data.nodeKind === 'action.setMaterialColor';
  const updatesUIDoc =
    node.data.nodeKind === 'ui.show' || node.data.nodeKind === 'ui.hide' || node.data.nodeKind === 'ui.setText';
  const updatesUIElement = node.data.nodeKind === 'ui.setText';
  const updatesObjectKey =
    node.data.nodeKind === 'variable.getObject' || node.data.nodeKind === 'variable.setObject';
  const updatesRandom = node.data.nodeKind === 'value.random';
  const updatesLoop = node.data.nodeKind === 'logic.forLoop';
  const updatesLoadScene = node.data.nodeKind === 'action.loadScene';
  const updatesCameraShake = node.data.nodeKind === 'action.cameraShake';
  const updatesExplode = node.data.nodeKind === 'action.explode';
  const isReceiveDamage = node.data.nodeKind === 'event.receiveDamage';
  const updatesQuality = node.data.nodeKind === 'action.setQuality';
  const updatesEnvironment = node.data.nodeKind === 'action.setEnvironment';
  const updatesPhysics = node.data.nodeKind === 'action.setPhysics';
  const updatesMoveTo = node.data.nodeKind === 'action.moveTo';
  const updatesTween = node.data.nodeKind === 'action.tweenProperty';
  const appliesDamage = node.data.nodeKind === 'action.applyDamage';
  const updatesCast = node.data.nodeKind === 'logic.cast';
  const findsActorByBlueprint = node.data.nodeKind === 'query.findActorByBlueprint';
  const findsActorByTag = node.data.nodeKind === 'query.findActorByTag';
  const findsActor = findsActorByBlueprint || findsActorByTag;
  const forEachActor = node.data.nodeKind === 'logic.forEachActor';
  const firesTargetedEvent = node.data.nodeKind === 'action.fireEvent';
  // Resolve the "context" blueprint behind a Get/Set Object Var's Target, so the Variable field becomes a TYPED
  // dropdown of THAT blueprint's declared instance variables (Unreal "Cast → As BP_X → pick its variable"):
  //  - Self / blank        → this blueprint (the owner)
  //  - $player             → the camera-follow player's blueprint
  //  - a specific object   → that object's blueprint
  //  - $cast / $trigger     → resolved only at runtime, so the user declares the expected type via castBlueprintId
  const playerBlueprintId = sceneObjects.find((o) => o.character?.cameraFollow)?.script?.blueprintId;
  const targetSel = node.data.targetObjectId;
  // If this node's "Target" pin is WIRED from a Cast node, take the type straight off that wire (Unreal "As
  // BP_X" → the picker is typed automatically, no manual blueprint pick).
  const targetWire = activeGraph?.edges.find((edge) => edge.target === node.id && edge.targetHandle === 'target');
  const wiredSource = targetWire ? activeGraph?.nodes.find((n) => n.id === targetWire.source) : undefined;
  // A wired Target whose source is a Cast OR a Find Actor By Blueprint carries a known blueprint type, so the
  // downstream Variable picker auto-scopes to that blueprint's declared instance variables (Unreal "As BP_X").
  const wiredCastBlueprintId =
    wiredSource?.data.nodeKind === 'logic.cast' ||
    wiredSource?.data.nodeKind === 'query.findActorByBlueprint' ||
    wiredSource?.data.nodeKind === 'logic.forEachActor'
      ? wiredSource.data.castBlueprintId
      : undefined;
  const isTargetWired = Boolean(targetWire);
  // The "context" blueprint whose declared variables fill the Variable dropdown.
  const needsTypePick = !isTargetWired && (targetSel === '$cast' || targetSel === '$trigger');
  const ctxBlueprintId =
    wiredCastBlueprintId ??
    (!targetSel || targetSel === '$self'
      ? activeBlueprintId
      : targetSel === '$player'
        ? playerBlueprintId
        : targetSel === '$cast' || targetSel === '$trigger'
          ? node.data.castBlueprintId
          : sceneObjects.find((o) => o.id === targetSel)?.script?.blueprintId);
  const ctxBlueprint = blueprints.find((b) => b.id === ctxBlueprintId);
  const ctxVars = ctxBlueprint?.variables ?? [];
  const updatesOtherObject =
    node.data.nodeKind === 'event.collisionEnter' ||
    node.data.nodeKind === 'event.collisionExit' ||
    node.data.nodeKind === 'event.triggerEnter' ||
    node.data.nodeKind === 'event.triggerExit';
  // The transform getters (Get Position/Rotation/Scale) read an actor via the full sentinel set, like
  // Get Object Var — so they get their own richer Target dropdown ($player/$trigger/$cast resolve at runtime).
  const readsTransformTarget =
    node.data.nodeKind === 'action.getPosition' ||
    node.data.nodeKind === 'action.getRotation' ||
    node.data.nodeKind === 'action.getScale';
  const updatesTargetObject =
    node.data.nodeKind === 'action.destroyObject' ||
    node.data.nodeKind === 'action.setRagdoll' ||
    node.data.nodeKind === 'action.burstParticles' ||
    node.data.nodeKind === 'action.setParticlesEmitting' ||
    node.data.nodeKind === 'action.spawnParticleSystem' ||
    node.data.nodeKind === 'action.fractureObject' ||
    node.data.nodeKind === 'action.setActive';
  const selectedUIDoc = uiDocuments.find((doc) => doc.id === node.data.documentId);
  const eventName = node.data.eventName || 'CustomEvent';
  const selectedVariable = variables.find((variable) => variable.id === node.data.variableId);
  // Get/Set Variable can also target THIS blueprint's instance variables (resolved on self at runtime),
  // so the obvious node shows them too — not just globals.
  const ownBlueprintVars = blueprints.find((b) => b.id === activeBlueprintId)?.variables ?? [];
  const selectedInstanceVar = node.data.objectKey ? ownBlueprintVars.find((v) => v.name === node.data.objectKey) : undefined;
  const selectedVarType = selectedVariable?.type ?? selectedInstanceVar?.type;
  const selectedTable = dataAssets.find((table) => table.id === node.data.tableId);
  const selectedColumn =
    selectedTable?.columns.find((column) => column.id === node.data.columnId) ?? selectedTable?.columns[0];
  const updateEnvPatchField = (key: EnvPatchKey, value: string | number | boolean | [number, number, number]) => {
    updateGraphNodeData(node.id, { envPatch: { ...(node.data.envPatch ?? {}), [key]: value } });
  };
  const clearEnvPatchField = (key: EnvPatchKey) => {
    const next = { ...(node.data.envPatch ?? {}) };
    delete next[key];
    updateGraphNodeData(node.id, { envPatch: Object.keys(next).length ? next : undefined });
  };

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
              {KEY_CODE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.group} · {option.label}
                </option>
              ))}
              {!KEY_CODE_OPTIONS.some((option) => option.code === node.data.keyCode) && node.data.keyCode && (
                <option value={node.data.keyCode}>{node.data.keyCode} (custom)</option>
              )}
            </select>
            <input
              value={node.data.keyCode ?? 'KeyW'}
              placeholder="KeyboardEvent.code or Mouse0"
              onChange={(event) => updateGraphNodeData(node.id, { keyCode: event.target.value.trim() || 'KeyW' })}
            />
            <small className="node-hint">Current: {keyLabelByCode(node.data.keyCode)}. Type any KeyboardEvent.code or Mouse0/Mouse1/Mouse2 for mouse buttons.</small>
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

        {isSwitch && (
          <>
            <small className="node-hint">
              The wired Value is matched against these cases (as text — numbers work too). Each case has its own
              exec pin; no match fires the Default pin. Perfect for a game-state variable: menu / playing / gameover.
            </small>
            {(node.data.switchCases ?? []).map((caseLabel, index) => (
              <label className="node-field" key={index}>
                <span>Case {index}</span>
                <div className="library-row">
                  <input
                    value={caseLabel}
                    onChange={(event) => {
                      const next = [...(node.data.switchCases ?? [])];
                      next[index] = event.target.value;
                      updateGraphNodeData(node.id, { switchCases: next });
                    }}
                  />
                  <button
                    title="Remove case"
                    onClick={() => updateGraphNodeData(node.id, { switchCases: (node.data.switchCases ?? []).filter((_, i) => i !== index) })}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              </label>
            ))}
            <button
              className="full-button"
              onClick={() => updateGraphNodeData(node.id, { switchCases: [...(node.data.switchCases ?? []), String(node.data.switchCases?.length ?? 0)] })}
            >
              ＋ Add case
            </button>
          </>
        )}

        {isRound && (
          <label className="node-field">
            <span>Mode</span>
            <select
              value={node.data.roundMode ?? 'round'}
              onChange={(event) => updateGraphNodeData(node.id, { roundMode: event.target.value as 'round' | 'floor' | 'ceil' })}
            >
              <option value="round">Round (nearest)</option>
              <option value="floor">Floor (down)</option>
              <option value="ceil">Ceil (up)</option>
            </select>
          </label>
        )}

        {isComment && (
          <>
            <label className="node-field">
              <span>Comment</span>
              <input
                value={node.data.message ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { message: event.target.value })}
              />
            </label>
            <label className="node-field">
              <span>Color</span>
              <input
                type="color"
                value={node.data.commentColor ?? '#7d8aa5'}
                onChange={(event) => updateGraphNodeData(node.id, { commentColor: event.target.value })}
              />
              <small className="node-hint">Drag the comment behind a group of nodes and resize its corner (when selected) to frame them.</small>
            </label>
          </>
        )}

        {updatesFunctionName && (
          <label className="node-field">
            <span>Function Name</span>
            <input
              value={node.data.functionName ?? 'MyFunction'}
              onChange={(event) => updateGraphNodeData(node.id, { functionName: event.target.value })}
            />
            <small className="node-hint">
              {node.data.nodeKind === 'event.functionEntry'
                ? 'This entry only runs when a "Call Function" with the same name executes.'
                : 'Runs the matching "Function" entry in this blueprint, then continues.'}
            </small>
          </label>
        )}

        {updatesOtherObject && (
          <label className="node-field">
            <span>Other Object</span>
            <select value={node.data.otherObjectId ?? ''} onChange={(event) => updateGraphNodeData(node.id, { otherObjectId: event.target.value || undefined })}>
              <option value="">Any object</option>
              {sceneObjects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
            <small className="node-hint">Leave blank to fire for any other collider; pick an object to filter the contact.</small>
          </label>
        )}

        {updatesNumberValue && (
          <label className="node-field">
            <span>
              {node.data.nodeKind === 'logic.compare'
                ? 'B fallback'
                : node.data.nodeKind === 'math.lerp'
                  ? 'T fallback'
                    : node.data.nodeKind === 'event.timer' || node.data.nodeKind === 'event.update'
                      ? 'Interval (seconds)'
                    : node.data.nodeKind === 'logic.cooldown' || node.data.nodeKind === 'logic.delay'
                      ? 'Seconds'
                    : node.data.nodeKind === 'action.setTimeScale'
                      ? 'Time scale (1 normal · 0 paused · 0.2 slow-mo)'
                      : 'Number'}
            </span>
            <input
              type="number"
              step="0.1"
              value={node.data.numberValue ?? 0}
              onChange={(event) => updateGraphNodeData(node.id, { numberValue: Number(event.target.value) })}
            />
          </label>
        )}

        {node.data.nodeKind === 'math.add' && (
          <label className="node-field">
            <span>B fallback</span>
            <input
              type="number"
              step="0.1"
              value={node.data.amount ?? 0}
              onChange={(event) => updateGraphNodeData(node.id, { amount: Number(event.target.value) })}
            />
          </label>
        )}

        {updatesRandom && (
          <>
            <label className="node-field">
              <span>Min</span>
              <input
                type="number"
                step="0.1"
                value={node.data.randomMin ?? 0}
                onChange={(event) => updateGraphNodeData(node.id, { randomMin: Number(event.target.value) })}
              />
            </label>
            <label className="node-field">
              <span>Max</span>
              <input
                type="number"
                step="0.1"
                value={node.data.randomMax ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { randomMax: Number(event.target.value) })}
              />
            </label>
            <label className="node-field node-field-row">
              <span>Whole number</span>
              <input
                type="checkbox"
                checked={Boolean(node.data.randomInteger)}
                onChange={(event) => updateGraphNodeData(node.id, { randomInteger: event.target.checked })}
              />
            </label>
            <small className="node-hint">Min/Max can also be wired. Whole-number mode includes Max (dice / index rolls).</small>
          </>
        )}

        {updatesLoop && (
          <label className="node-field">
            <span>Iterations</span>
            <input
              type="number"
              step="1"
              min="0"
              value={node.data.loopCount ?? 4}
              onChange={(event) => updateGraphNodeData(node.id, { loopCount: Math.max(0, Math.floor(Number(event.target.value))) })}
            />
            <small className="node-hint">Fires "Body" this many times (index on the value-out), then "Completed". Capped at 10000.</small>
          </label>
        )}

        {updatesMoveTo && (
          <label className="node-field">
            <span>Arrival radius</span>
            <input
              type="number"
              step="0.1"
              min="0.2"
              value={node.data.numberValue ?? 1.2}
              onChange={(event) => updateGraphNodeData(node.id, { numberValue: Math.max(0.2, Number(event.target.value)) })}
            />
            <small className="node-hint">Stops this far from the Target. Wire Player Location (chase) or a waypoint position into Target; Speed is optional.</small>
          </label>
        )}

        {updatesCameraShake && (
          <label className="node-field">
            <span>Shake amount</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={node.data.shakeAmount ?? 0.6}
              onChange={(event) => updateGraphNodeData(node.id, { shakeAmount: Math.max(0, Math.min(1, Number(event.target.value))) })}
            />
            <small className="node-hint">Trauma 0–1 added to the camera (fades automatically). 0.6 ≈ a solid hit; 1 = a big explosion.</small>
          </label>
        )}

        {isReceiveDamage && (
          <label className="node-field">
            <span>Health (HP)</span>
            <input
              type="number"
              step="1"
              min="0"
              value={node.data.startingHealth ?? 0}
              onChange={(event) => updateGraphNodeData(node.id, { startingHealth: Math.max(0, Number(event.target.value)) })}
            />
            <small className="node-hint">
              Gives this object an HP pool so damage reduces it and it DIES at 0 (ragdoll/shatter/despawn) — no need to add a <code>health</code> variable by hand. Leave 0 to just react to hits without dying. An explicit <code>health</code> instance var (or a gameplay kit) overrides this.
            </small>
          </label>
        )}

        {updatesExplode && (
          <>
            <label className="node-field">
              <span>At (Target)</span>
              <select
                value={node.data.targetObjectId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
              >
                <option value="">Self (this object)</option>
                <option value="$player">Player</option>
                <option value="$trigger">Trigger toucher ($trigger)</option>
                <option value="$cast">Cast result ($cast)</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>{object.name}</option>
                ))}
              </select>
              <small className="node-hint">Blast origin. Or wire a Vector3 into the Location input (e.g. a hit point).</small>
            </label>
            <label className="node-field">
              <span>Radius</span>
              <input type="number" step="0.5" min="0.1" value={node.data.explodeRadius ?? 5}
                onChange={(event) => updateGraphNodeData(node.id, { explodeRadius: Math.max(0.1, Number(event.target.value)) })} />
            </label>
            <label className="node-field">
              <span>Force</span>
              <input type="number" step="1" min="0" value={node.data.explodeForce ?? 16}
                onChange={(event) => updateGraphNodeData(node.id, { explodeForce: Math.max(0, Number(event.target.value)) })} />
              <small className="node-hint">Outward physics impulse that flings nearby dynamic bodies. 0 = damage/FX only.</small>
            </label>
            <label className="node-field">
              <span>Damage</span>
              <input type="number" step="1" min="0" value={node.data.explodeDamage ?? 50}
                onChange={(event) => updateGraphNodeData(node.id, { explodeDamage: Math.max(0, Number(event.target.value)) })} />
              <small className="node-hint">HP dealt (flat) to objects with a <code>health</code> var in range. Fires their <strong>On Receive Damage</strong> event, and kills/fractures/ragdolls them at 0 HP. 0 = a push-only blast.</small>
            </label>
          </>
        )}

        {appliesDamage && (
          <>
            <label className="node-field">
              <span>Target</span>
              <select
                value={node.data.targetObjectId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
              >
                <option value="">Self (this object)</option>
                <option value="$player">Player</option>
                <option value="$trigger">Trigger toucher ($trigger)</option>
                <option value="$cast">Cast result ($cast)</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">Who takes the damage. Or wire an object reference (e.g. a Cast’s "As" pin, $trigger) into the Target input.</small>
            </label>
            <label className="node-field">
              <span>Damage</span>
              <input
                type="number"
                step="1"
                min="0"
                value={node.data.damageAmount ?? 10}
                onChange={(event) => updateGraphNodeData(node.id, { damageAmount: Math.max(0, Number(event.target.value)) })}
              />
              <small className="node-hint">HP subtracted from the target’s <code>health</code> variable (the Amount input overrides this). The target needs a <code>health</code> instance variable. At 0 HP it dies.</small>
            </label>
          </>
        )}

        {updatesTween && (
          <>
            <label className="node-field">
              <span>Property</span>
              <select
                value={node.data.tweenProperty ?? 'position'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, { tweenProperty: event.target.value as 'position' | 'rotation' | 'scale' })
                }
              >
                <option value="position">Position</option>
                <option value="rotation">Rotation (degrees)</option>
                <option value="scale">Scale</option>
              </select>
            </label>
            <label className="node-field">
              <span>To</span>
              <div className="vec-inline">
                {([0, 1, 2] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step="0.1"
                    value={Number((node.data.vectorValue ?? [0, 0, 0])[axis] ?? 0)}
                    onChange={(event) => {
                      const next = [...(node.data.vectorValue ?? [0, 0, 0])] as Vector3Tuple;
                      next[axis] = Number(event.target.value);
                      updateGraphNodeData(node.id, { vectorValue: next });
                    }}
                  />
                ))}
              </div>
              <small className="node-hint">World-space end value (rotation in degrees). A Vector3 wired into To overrides this.</small>
            </label>
            <label className="node-field">
              <span>Duration (s)</span>
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={node.data.numberValue ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { numberValue: Math.max(0.01, Number(event.target.value)) })}
              />
            </label>
            <label className="node-field">
              <span>Easing</span>
              <select
                value={node.data.easing ?? 'easeInOut'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, { easing: event.target.value as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' })
                }
              >
                <option value="easeInOut">Ease In-Out (smooth)</option>
                <option value="easeIn">Ease In (accelerate)</option>
                <option value="easeOut">Ease Out (decelerate)</option>
                <option value="linear">Linear (constant)</option>
              </select>
            </label>
            <label className="node-field">
              <span>Target</span>
              <select
                value={node.data.targetObjectId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
              >
                <option value="">Self (this object)</option>
                <option value="$player">Player ($player)</option>
                <option value="$trigger">Trigger toucher ($trigger)</option>
                <option value="$cast">Cast result ($cast)</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">Whose transform animates. Exec-out continues immediately; the Done pin fires when the tween finishes.</small>
            </label>
          </>
        )}

        {updatesQuality && (
          <label className="node-field">
            <span>Quality</span>
            <select
              value={node.data.qualityLevel ?? 'High'}
              onChange={(event) => updateGraphNodeData(node.id, { qualityLevel: event.target.value as QualityLevel })}
            >
              {QUALITY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <small className="node-hint">Sets the game quality preset at runtime (resolution, shadows, post-FX). Lower = faster.</small>
          </label>
        )}

        {updatesEnvironment && (
          <>
            <small className="node-hint">Only fields set in this patch change at runtime. Clear a row to leave that environment value alone.</small>
            {environmentFields.map((field) => {
              const value = node.data.envPatch?.[field.key];
              const sceneValue = activeScene?.environment?.[field.key];
              const isSet = value !== undefined;
              return (
                <label key={field.key} className="node-field">
                  <span>{field.label}{isSet ? '' : ' (unchanged)'}</span>
                  <div className="library-row">
                    {field.type === 'vector' ? (
                      <div className="vec-inline">
                        {([0, 1, 2] as const).map((axis) => {
                          const vec = (Array.isArray(value) ? value : Array.isArray(sceneValue) ? sceneValue : [0, 0, 0]) as number[];
                          return (
                            <input
                              key={axis}
                              type="number"
                              step={field.step}
                              value={Number(vec[axis] ?? 0)}
                              onChange={(event) => {
                                const next = [...vec] as [number, number, number];
                                next[axis] = Number(event.target.value);
                                updateEnvPatchField(field.key, next);
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : field.type === 'boolean' ? (
                      <select
                        value={String(typeof value === 'boolean' ? value : Boolean(sceneValue))}
                        onChange={(event) => updateEnvPatchField(field.key, event.target.value === 'true')}
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        step={field.step}
                        min={field.min}
                        value={field.type === 'number' ? Number(value ?? sceneValue ?? 0) : String(value ?? sceneValue ?? '#ffffff')}
                        onChange={(event) => updateEnvPatchField(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)}
                      />
                    )}
                    <button title={`Clear ${field.label}`} disabled={!isSet} onClick={() => clearEnvPatchField(field.key)}>
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                </label>
              );
            })}
          </>
        )}

        {updatesLoadScene && (
          <label className="node-field">
            <span>Scene</span>
            <select
              value={node.data.targetSceneId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { targetSceneId: event.target.value || undefined })}
            >
              <option value="">Select a scene…</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
            <small className="node-hint">Switches scene during Play. Project variables persist; the leaving scene resets.</small>
          </label>
        )}

        {(node.data.nodeKind === 'math.clamp' || node.data.nodeKind === 'math.lerp') && (
          <label className="node-field">
            <span>{node.data.nodeKind === 'math.clamp' ? 'Max fallback' : 'B fallback'}</span>
            <input
              type="number"
              step="0.1"
              value={node.data.amount ?? 1}
              onChange={(event) => updateGraphNodeData(node.id, { amount: Number(event.target.value) })}
            />
          </label>
        )}

        {updatesCompare && (
          <label className="node-field">
            <span>Operator</span>
            <select
              value={node.data.compareOp ?? '=='}
              onChange={(event) => updateGraphNodeData(node.id, { compareOp: event.target.value as (typeof compareOps)[number] })}
            >
              {compareOps.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesStringValue && (
          <label className="node-field">
            <span>Text</span>
            <input value={node.data.stringValue ?? ''} onChange={(event) => updateGraphNodeData(node.id, { stringValue: event.target.value })} />
          </label>
        )}

        {updatesBooleanValue && (
          <label className="node-field">
            <span>{node.data.nodeKind === 'logic.branch' ? 'Condition fallback' : 'Value'}</span>
            <select
              value={node.data.booleanValue ? 'true' : 'false'}
              onChange={(event) => updateGraphNodeData(node.id, { booleanValue: event.target.value === 'true' })}
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </label>
        )}

        {updatesVectorValue && (
          <label className="node-field">
            <span>{node.data.nodeKind === 'action.spawnParticleSystem' ? 'Offset' : 'Vector'}</span>
            <ValueEditor
              type="vector3"
              value={node.data.vectorValue ?? [0, 0, 0]}
              onChange={(value) => updateGraphNodeData(node.id, graphValuePatch('vector3', value))}
            />
          </label>
        )}

        {updatesVariable && (
          <>
            <label className="node-field">
              <span>Variable</span>
              <select
                value={node.data.variableId ? `g:${node.data.variableId}` : node.data.objectKey ? `i:${node.data.objectKey}` : ''}
                onChange={(event) => {
                  const v = event.target.value;
                  if (v.startsWith('g:')) {
                    const variable = variables.find((vr) => vr.id === v.slice(2));
                    updateGraphNodeData(node.id, { variableId: v.slice(2), objectKey: undefined, valueType: variable?.type });
                  } else if (v.startsWith('i:')) {
                    const iv = ownBlueprintVars.find((vr) => vr.name === v.slice(2));
                    updateGraphNodeData(node.id, { objectKey: v.slice(2), variableId: undefined, valueType: iv?.type });
                  } else {
                    updateGraphNodeData(node.id, { variableId: undefined, objectKey: undefined });
                  }
                }}
              >
                <option value="">{variables.length || ownBlueprintVars.length ? 'Select variable' : 'Create a variable below'}</option>
                {ownBlueprintVars.length > 0 && (
                  <optgroup label="This blueprint (instance · per-object)">
                    {ownBlueprintVars.map((variable) => (
                      <option key={variable.id} value={`i:${variable.name}`}>
                        {variable.name} · {variable.type}
                      </option>
                    ))}
                  </optgroup>
                )}
                {variables.length > 0 && (
                  <optgroup label="Global (shared)">
                    {variables.map((variable) => (
                      <option key={variable.id} value={`g:${variable.id}`}>
                        {variable.name} · {variable.type}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedInstanceVar && (
                <small className="node-hint">Instance variable on THIS object (self). For another object's instance var, use Get/Set Object Var with a Target.</small>
              )}
            </label>
            {node.data.nodeKind === 'variable.set' && selectedVarType && (
              <label className="node-field">
                <span>Fallback value</span>
                <ValueEditor
                  type={selectedVarType}
                  value={graphValueFromNode(node, selectedVarType)}
                  onChange={(value) => updateGraphNodeData(node.id, graphValuePatch(selectedVarType, value))}
                />
              </label>
            )}
          </>
        )}

        {updatesDataAsset && (
          <>
            <label className="node-field">
              <span>Data Asset</span>
              <select
                value={node.data.tableId ?? ''}
                onChange={(event) => {
                  const table = dataAssets.find((item) => item.id === event.target.value);
                  updateGraphNodeData(node.id, {
                    tableId: table?.id,
                    rowKey: table?.rows[0]?.key,
                    columnId: table?.columns[0]?.id,
                  });
                }}
              >
                <option value="">{dataAssets.length ? 'Select Data Asset' : 'Create a Data Asset first'}</option>
                {dataAssets.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedTable && (
              <>
                <label className="node-field">
                  <span>Row</span>
                  <select
                    value={node.data.rowKey ?? selectedTable.rows[0]?.key ?? ''}
                    onChange={(event) => updateGraphNodeData(node.id, { rowKey: event.target.value })}
                  >
                    {selectedTable.rows.map((row) => (
                      <option key={row.id} value={row.key}>
                        {row.key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="node-field">
                  <span>Column</span>
                  <select
                    value={selectedColumn?.id ?? ''}
                    onChange={(event) => updateGraphNodeData(node.id, { columnId: event.target.value })}
                  >
                    {selectedTable.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name} · {column.type}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </>
        )}

        {updatesSaveSlot && (
          <label className="node-field">
            <span>Save Slot</span>
            <input value={node.data.saveSlot ?? 'slot1'} onChange={(event) => updateGraphNodeData(node.id, { saveSlot: event.target.value })} />
          </label>
        )}

        {updatesMaterialColorTarget && (
          <label className="node-field">
            <span>Target</span>
            <select
              value={node.data.materialColorTarget ?? 'base'}
              onChange={(event) =>
                updateGraphNodeData(node.id, { materialColorTarget: event.target.value as 'base' | 'emissive' })
              }
            >
              <option value="base">Base Color</option>
              <option value="emissive">Emissive Color</option>
            </select>
          </label>
        )}

        {updatesMaterialColor && (
          <label className="node-field">
            <span>Color</span>
            <input
              type="color"
              value={node.data.materialColor ?? '#ff5555'}
              onChange={(event) => updateGraphNodeData(node.id, { materialColor: event.target.value })}
            />
          </label>
        )}

        {updatesMaterialProperty && (
          <>
            <label className="node-field">
              <span>Property</span>
              <select
                value={node.data.materialProperty ?? 'metalness'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, {
                    materialProperty: event.target.value as 'metalness' | 'roughness' | 'emissiveIntensity',
                  })
                }
              >
                <option value="metalness">Metalness</option>
                <option value="roughness">Roughness</option>
                <option value="emissiveIntensity">Emissive Intensity</option>
              </select>
            </label>
            {node.data.nodeKind === 'action.setMaterialProperty' && (
              <label className="node-field">
                <span>Value</span>
                <input
                  type="number"
                  step="0.05"
                  value={node.data.numberValue ?? 1}
                  onChange={(event) => updateGraphNodeData(node.id, { numberValue: Number(event.target.value) })}
                />
              </label>
            )}
          </>
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
              <span>
                {node.data.nodeKind === 'action.rotate'
                  ? 'Degrees / sec'
                  : node.data.nodeKind === 'action.applyForce'
                    ? 'Force'
                    : node.data.nodeKind === 'action.applyImpulse'
                      ? 'Impulse'
                    : 'Units / sec'}
              </span>
              <input
                type="number"
                step="0.1"
                value={node.data.amount ?? (node.data.nodeKind === 'action.rotate' ? 90 : node.data.nodeKind === 'action.applyForce' || node.data.nodeKind === 'action.applyImpulse' ? 8 : -3.6)}
                onChange={(event) => updateGraphNodeData(node.id, { amount: Number(event.target.value) })}
              />
            </label>
          </>
        )}

        {updatesImpulseSpace && (
          <label className="node-field">
            <span>Space</span>
            <select
              value={node.data.space ?? 'world'}
              onChange={(event) => updateGraphNodeData(node.id, { space: event.target.value as 'world' | 'local' })}
            >
              <option value="world">World axes</option>
              <option value="local">Target local axes</option>
            </select>
            <small className="node-hint">Local +Z follows the target's forward direction, useful for car nitro, dashes, and knockback from an actor's facing.</small>
          </label>
        )}

        {updatesMessage && (
          <label className="node-field">
            <span>Message</span>
            <input
              value={node.data.message ?? ''}
              placeholder="Text to print"
              onChange={(event) => updateGraphNodeData(node.id, { message: event.target.value })}
            />
          </label>
        )}

        {forEachActor && (
          <>
            <label className="node-field">
              <span>Of Blueprint (optional)</span>
              <select
                value={node.data.castBlueprintId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { castBlueprintId: event.target.value || undefined })}
              >
                <option value="">— none (use Tag) —</option>
                {blueprints.map((bp) => (
                  <option key={bp.id} value={bp.id}>
                    {bp.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">Iterate every actor running this blueprint. Leave blank to filter by Tag instead.</small>
            </label>
            {!node.data.castBlueprintId && (
              <label className="node-field">
                <span>Tag</span>
                <input
                  value={node.data.stringValue ?? ''}
                  placeholder="e.g. Enemy, Pickup"
                  onChange={(event) => updateGraphNodeData(node.id, { stringValue: event.target.value })}
                />
                <small className="node-hint">Iterate every actor with this Tag (from the object Inspector's Tags section).</small>
              </label>
            )}
            <small className="node-hint">
              Body fires once per matching actor; wire its value-out (the current Actor) into a Cast / Get Position / Set Object Var / Apply Damage Target.
            </small>
          </>
        )}

        {findsActor && (
          <>
            {findsActorByBlueprint && (
              <label className="node-field">
                <span>Of Blueprint (class)</span>
                <select
                  value={node.data.castBlueprintId ?? ''}
                  onChange={(event) => updateGraphNodeData(node.id, { castBlueprintId: event.target.value || undefined })}
                >
                  <option value="">— pick a blueprint —</option>
                  {blueprints.map((bp) => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}
                    </option>
                  ))}
                </select>
                <small className="node-hint">
                  Finds an actor running this blueprint. Wire the output into a Cast (to access its typed variables) or
                  into Get/Set Object Var / Get Position’s Target.
                </small>
              </label>
            )}
            {findsActorByTag && (
              <>
                <label className="node-field">
                  <span>Tag</span>
                  <input
                    value={node.data.stringValue ?? ''}
                    placeholder="e.g. test, Enemy, Objective"
                    onChange={(event) => updateGraphNodeData(node.id, { stringValue: event.target.value })}
                  />
                  <small className="node-hint">
                    The tag to find — must match a chip in the target object’s Inspector “Tags” section. Leave blank to find any tagged actor.
                  </small>
                </label>
                <label className="node-field">
                  <span>Variable key (advanced)</span>
                  <input
                    value={node.data.objectKey ?? ''}
                    placeholder="tags"
                    onChange={(event) => updateGraphNodeData(node.id, { objectKey: event.target.value })}
                  />
                  <small className="node-hint">
                    Which instance variable holds the tag list — defaults to “tags” (what the Tags section writes). Change only for custom flag vars.
                  </small>
                </label>
              </>
            )}
            <label className="node-field">
              <span>Mode</span>
              <select
                value={node.data.findMode ?? 'first'}
                onChange={(event) => updateGraphNodeData(node.id, { findMode: event.target.value as 'first' | 'nearest' })}
              >
                <option value="first">First found (cheap, deterministic)</option>
                <option value="nearest">Nearest to me</option>
              </select>
              <small className="node-hint">Run it on an event or behind a Cooldown — not raw Update — in a large scene.</small>
            </label>
          </>
        )}

        {(readsTransformTarget || firesTargetedEvent || updatesPhysics) && (
          <label className="node-field">
            <span>Target</span>
            <select
              value={node.data.targetObjectId ?? ''}
              disabled={isTargetWired}
              onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
            >
              <option value="">Self (this object)</option>
              <option value="$player">Player</option>
              <option value="$trigger">Trigger toucher ($trigger)</option>
              <option value="$cast">Cast result ($cast)</option>
              {sceneObjects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
            <small className="node-hint">
              {isTargetWired
                ? 'Driven by the wired Target pin — this dropdown is ignored while connected.'
                : firesTargetedEvent
                  ? 'Self fires this graph’s own Custom Event now. A Target fires the event on THAT actor’s blueprint next frame (Unreal call-event-on-reference). Or wire a reference into Target.'
                  : updatesPhysics
                    ? 'Which actor to configure — self, the player, the trigger toucher, a Cast result, or a specific object. Or wire a reference into the Target input.'
                  : 'Which actor to read — self, the player, the trigger toucher, a Cast result, or a specific object. Or wire a reference into the Target input.'}
            </small>
          </label>
        )}

        {updatesPhysics && (
          <>
            <div className="node-field-group-title">
              <Boxes size={14} aria-hidden />
              <span>Runtime Physics Options</span>
            </div>
            <label className="library-check" title="Enable or disable the target object's physics body during Play">
              <input
                type="checkbox"
                checked={node.data.physicsEnabled !== false}
                onChange={(event) => updateGraphNodeData(node.id, { physicsEnabled: event.target.checked })}
              />
              <span>Physics enabled</span>
            </label>
            <div className="node-field-grid two">
              <label className="node-field">
                <span>Body Type</span>
                <select
                  value={node.data.physicsBodyType ?? 'dynamic'}
                  onChange={(event) => updateGraphNodeData(node.id, { physicsBodyType: event.target.value as 'dynamic' | 'fixed' | 'kinematic' })}
                >
                  <option value="dynamic">Dynamic</option>
                  <option value="fixed">Fixed</option>
                  <option value="kinematic">Kinematic</option>
                </select>
              </label>
              <label className="node-field">
                <span>Collider</span>
                <select
                  value={node.data.physicsCollider ?? 'box'}
                  onChange={(event) => updateGraphNodeData(node.id, { physicsCollider: event.target.value as 'box' | 'sphere' | 'capsule' | 'mesh' | 'convex' })}
                >
                  <option value="box">Box</option>
                  <option value="sphere">Sphere</option>
                  <option value="capsule">Capsule</option>
                  <option value="mesh">Mesh</option>
                  <option value="convex">Convex</option>
                </select>
              </label>
            </div>
            <label className="library-check" title="Trigger colliders fire overlap events but do not block or push">
              <input
                type="checkbox"
                checked={Boolean(node.data.physicsIsTrigger)}
                onChange={(event) => updateGraphNodeData(node.id, { physicsIsTrigger: event.target.checked })}
              />
              <span>Trigger collider</span>
            </label>
            <div className="node-field-grid two">
              <label className="node-field">
                <span>Mass</span>
                <input type="number" step="0.1" min="0.001" value={node.data.physicsMass ?? 1} onChange={(event) => updateGraphNodeData(node.id, { physicsMass: Math.max(0.001, Number(event.target.value)) })} />
              </label>
              <label className="node-field">
                <span>Gravity Scale</span>
                <input type="number" step="0.1" value={node.data.physicsGravityScale ?? 1} onChange={(event) => updateGraphNodeData(node.id, { physicsGravityScale: Number(event.target.value) })} />
              </label>
              <label className="node-field">
                <span>Friction</span>
                <input type="number" step="0.05" min="0" value={node.data.physicsFriction ?? 0.6} onChange={(event) => updateGraphNodeData(node.id, { physicsFriction: Math.max(0, Number(event.target.value)) })} />
              </label>
              <label className="node-field">
                <span>Linear Damping</span>
                <input type="number" step="0.05" min="0" value={node.data.physicsLinearDamping ?? 0} onChange={(event) => updateGraphNodeData(node.id, { physicsLinearDamping: Math.max(0, Number(event.target.value)) })} />
              </label>
              <label className="node-field">
                <span>Angular Damping</span>
                <input type="number" step="0.05" min="0" value={node.data.physicsAngularDamping ?? 0.05} onChange={(event) => updateGraphNodeData(node.id, { physicsAngularDamping: Math.max(0, Number(event.target.value)) })} />
              </label>
            </div>
            <small className="node-hint">These options apply during Play when execution reaches this node. Wire Target for a specific actor, or leave it as Self.</small>
          </>
        )}

        {updatesTargetObject && (
          <label className="node-field">
            <span>Target</span>
            <select value={node.data.targetObjectId ?? ''} onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}>
              <option value="">Self (this object)</option>
              {sceneObjects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
            <small className="node-hint">
              {node.data.nodeKind === 'action.destroyObject'
                ? 'Self is the usual choice for pickups and temporary objects.'
                : 'Leave blank to affect the object running this blueprint.'}
            </small>
          </label>
        )}

        {/* 1) Choose the Animator (which object), 2) then its parameters fill the dropdown below. */}
        {isAnimNode && (
          <label className="node-field">
            <span>Animator</span>
            <select value={node.data.targetObjectId ?? ''} onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}>
              <option value="">Self (this object)</option>
              {animObjects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                  {object.controllerName ? ` · ${object.controllerName}` : ''}
                </option>
              ))}
            </select>
            <small className="node-hint">
              {targetController ? `Reading from “${targetController.name}”.` : 'Pick an object with an Animator Controller.'}
            </small>
          </label>
        )}

        {updatesParamName && (
          <label className="node-field">
            <span>Parameter</span>
            <select value={node.data.paramName ?? ''} onChange={(event) => updateGraphNodeData(node.id, { paramName: event.target.value })} disabled={animParams.length === 0}>
              <option value="">Pick a parameter…</option>
              {animParams.map((param) => (
                <option key={param.id} value={param.name}>
                  {param.name} · {param.type}
                </option>
              ))}
              {/* Preserve a name not in the chosen controller (e.g. set before it existed). */}
              {node.data.paramName && !animParams.some((p) => p.name === node.data.paramName) && (
                <option value={node.data.paramName}>{node.data.paramName} (custom)</option>
              )}
            </select>
            {animParams.length === 0 && <small className="node-hint">Choose an Animator above (one with parameters) to list its variables.</small>}
            {(() => {
              const selected = animParams.find((p) => p.name === node.data.paramName);
              if (selected && selected.source !== 'manual' && node.data.nodeKind.startsWith('animator.set')) {
                return (
                  <small className="node-hint node-warn">
                    “{selected.name}” is auto‑driven (source: {selected.source}) — the animator recomputes it every frame, so your Set won't stick. Set its Source to “Manual” in the Animator panel to control it from script.
                  </small>
                );
              }
              return null;
            })()}
          </label>
        )}

        {updatesSound && (
          <label className="node-field">
            <span>Sound</span>
            <select
              value={node.data.assetId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { assetId: event.target.value || undefined })}
            >
              <option value="">{audioAssets.length ? 'Select audio…' : 'No audio assets imported'}</option>
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesCinematic && (
          <label className="node-field">
            <span>Cinematic</span>
            <select
              value={node.data.cinematicId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { cinematicId: event.target.value || undefined })}
            >
              <option value="">{activeScene?.cinematics?.length ? 'Select cinematic…' : 'No cinematics in scene'}</option>
              {(activeScene?.cinematics ?? []).map((cinematic) => (
                <option key={cinematic.id} value={cinematic.id}>
                  {cinematic.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesParticleSystem && (
          <label className="node-field">
            <span>Particle System</span>
            <select
              value={node.data.particleSystemId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { particleSystemId: event.target.value || undefined })}
            >
              <option value="">{particleSystems.length ? 'Select particle system…' : 'No particle systems yet'}</option>
              {particleSystems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesSpawn && (
          <label className="node-field">
            <span>Spawns</span>
            <select
              value={node.data.spawnKind ?? 'cube'}
              onChange={(event) =>
                updateGraphNodeData(node.id, { spawnKind: event.target.value as 'cube' | 'sphere' | 'capsule' | 'plane' })
              }
            >
              {spawnKinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesProjectile && (
          <>
            <label className="node-field">
              <span>Template Object</span>
              <select
                value={node.data.projectileTemplateId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { projectileTemplateId: event.target.value || undefined })}
              >
                <option value="">Built-in sphere</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">
                Pick a scene object to clone as the bullet (its mesh/model, scale &amp; material). Leave on “Built-in sphere” to use Size + Color below.
              </small>
            </label>

            <label className="node-field">
              <span>Speed</span>
              <input
                type="number"
                step="0.5"
                value={node.data.projectileSpeed ?? 20}
                onChange={(event) => updateGraphNodeData(node.id, { projectileSpeed: Number(event.target.value) })}
              />
            </label>

            <label className="node-field">
              <span>Damage</span>
              <input
                type="number"
                step="1"
                value={node.data.projectileDamage ?? 25}
                onChange={(event) => updateGraphNodeData(node.id, { projectileDamage: Number(event.target.value) })}
              />
              <small className="node-hint">Subtracted from the struck object’s <code>health</code> variable.</small>
            </label>

            <label className="node-field">
              <span>Spread (°)</span>
              <input
                type="number"
                step="0.5"
                min="0"
                value={node.data.projectileSpread ?? 0}
                onChange={(event) => updateGraphNodeData(node.id, { projectileSpread: Math.max(0, Number(event.target.value)) })}
              />
              <small className="node-hint">Random firing-cone half-angle. 0 = pin-accurate; 2–5° = rifle bloom; 8–12° = shotgun/SMG.</small>
            </label>

            {!node.data.projectileTemplateId && (
              <>
                <label className="node-field">
                  <span>Size</span>
                  <input
                    type="number"
                    step="0.02"
                    min="0.01"
                    value={node.data.projectileSize ?? 0.18}
                    onChange={(event) => updateGraphNodeData(node.id, { projectileSize: Number(event.target.value) })}
                  />
                </label>

                <label className="node-field">
                  <span>Color</span>
                  <input
                    type="color"
                    value={node.data.projectileColor ?? '#ffd166'}
                    onChange={(event) => updateGraphNodeData(node.id, { projectileColor: event.target.value })}
                  />
                </label>
              </>
            )}

            <label className="node-field">
              <span>Lifetime (s)</span>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={node.data.projectileLife ?? 3}
                onChange={(event) => updateGraphNodeData(node.id, { projectileLife: Number(event.target.value) })}
              />
              <small className="node-hint">Auto-despawns after this many seconds if it hits nothing.</small>
            </label>

            <label className="node-field">
              <span>Gravity</span>
              <input
                type="number"
                step="0.1"
                value={node.data.projectileGravity ?? 0}
                onChange={(event) => updateGraphNodeData(node.id, { projectileGravity: Number(event.target.value) })}
              />
              <small className="node-hint">0 = flies straight. Raise it (e.g. 1) for an arcing grenade/arrow.</small>
            </label>

            <label className="node-field">
              <span>Knockback</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={node.data.projectileKnockback ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { projectileKnockback: Number(event.target.value) })}
              />
              <small className="node-hint">How hard a hit shoves a dynamic prop (box/crate/barrel). 0 = no push, 1 = default, higher = harder.</small>
            </label>

            <label className="library-check" title="Detonate on impact / fuse-out instead of a plain hit (grenades, rockets)">
              <input
                type="checkbox"
                checked={Boolean(node.data.projectileExplosive)}
                onChange={(event) => updateGraphNodeData(node.id, { projectileExplosive: event.target.checked })}
              />
              <span>Explosive (detonate on impact)</span>
            </label>

            {node.data.projectileExplosive && (
              <>
                <label className="node-field">
                  <span>Blast Radius</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={node.data.projectileBlastRadius ?? 4.5}
                    onChange={(event) => updateGraphNodeData(node.id, { projectileBlastRadius: Number(event.target.value) })}
                  />
                  <small className="node-hint">Everything with health within this radius takes the blast.</small>
                </label>
                <label className="node-field">
                  <span>Blast Damage</span>
                  <input
                    type="number"
                    step="5"
                    min="0"
                    value={node.data.projectileBlastDamage ?? 60}
                    onChange={(event) => updateGraphNodeData(node.id, { projectileBlastDamage: Number(event.target.value) })}
                  />
                </label>
              </>
            )}

            <label className="library-check" title="Log every spawn and hit to the runtime console">
              <input
                type="checkbox"
                checked={Boolean(node.data.projectileDebug)}
                onChange={(event) => updateGraphNodeData(node.id, { projectileDebug: event.target.checked })}
              />
              <span>Debug (log spawns + hits to console)</span>
            </label>
          </>
        )}

        {updatesUIDoc && (
          <label className="node-field">
            <span>UI Document</span>
            <select
              value={node.data.documentId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { documentId: event.target.value || undefined })}
            >
              <option value="">{uiDocuments.length ? 'Select UI…' : 'No UI documents'}</option>
              {uiDocuments.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name} · {doc.surface}
                </option>
              ))}
            </select>
          </label>
        )}

        {updatesUIElement && selectedUIDoc && (
          <label className="node-field">
            <span>Element</span>
            <select
              value={node.data.elementId ?? ''}
              onChange={(event) => updateGraphNodeData(node.id, { elementId: event.target.value || undefined })}
            >
              <option value="">Select element…</option>
              {flattenUIElements(selectedUIDoc.root).map((el) => (
                <option key={el.id} value={el.id}>
                  {el.label}
                </option>
              ))}
            </select>
            <small className="node-hint">Wire a value into the Text input, or set a literal String node.</small>
          </label>
        )}

        {updatesObjectKey && (
          <>
            <label className="node-field">
              <span>Target</span>
              <select
                value={node.data.targetObjectId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
              >
                <option value="">Self (this object)</option>
                <option value="$player">Player</option>
                <option value="$trigger">Trigger toucher ($trigger)</option>
                <option value="$cast">Cast result ($cast)</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">
                {isTargetWired
                  ? `Driven by the wired Target pin${ctxBlueprint ? ` (a ${ctxBlueprint.name} reference)` : ''} — this dropdown is ignored while connected.`
                  : 'Whose instance this reads/writes — self, the player, the trigger toucher, a Cast result, or a specific object. Or wire a Cast’s "As" pin into the Target input.'}
              </small>
            </label>
            {needsTypePick && (
              <label className="node-field">
                <span>Of Blueprint (type)</span>
                <select
                  value={node.data.castBlueprintId ?? ''}
                  onChange={(event) => updateGraphNodeData(node.id, { castBlueprintId: event.target.value || undefined })}
                >
                  <option value="">— pick the type —</option>
                  {blueprints.map((bp) => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}
                    </option>
                  ))}
                </select>
                <small className="node-hint">
                  {targetSel === '$cast'
                    ? 'Match the blueprint your upstream Cast checked — its declared variables fill the picker below.'
                    : 'The blueprint you expect the toucher to be — its declared variables fill the picker below.'}
                </small>
              </label>
            )}
            {ctxVars.length > 0 ? (
              <label className="node-field">
                <span>Variable{ctxBlueprint ? ` · ${ctxBlueprint.name}` : ''}</span>
                <select value={node.data.objectKey ?? ''} onChange={(event) => updateGraphNodeData(node.id, { objectKey: event.target.value })}>
                  <option value="">— pick a variable —</option>
                  {ctxVars.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name} ({v.type})
                    </option>
                  ))}
                </select>
                <small className="node-hint">A per-instance variable of {ctxBlueprint?.name ?? 'that blueprint'} — each instance holds its own value.</small>
              </label>
            ) : (
              <label className="node-field">
                <span>Variable Key</span>
                <input
                  value={node.data.objectKey ?? ''}
                  placeholder="e.g. health"
                  onChange={(event) => updateGraphNodeData(node.id, { objectKey: event.target.value })}
                />
                <small className="node-hint">
                  {needsTypePick
                    ? 'Pick the blueprint type above to choose from its declared variables, or type a key directly.'
                    : 'No instance variables declared on the target blueprint yet — declare them in the Instance Variables panel, or type a key.'}
                </small>
              </label>
            )}
          </>
        )}

        {updatesCast && (
          <>
            <label className="node-field">
              <span>Cast To Blueprint</span>
              <select
                value={node.data.castBlueprintId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { castBlueprintId: event.target.value || undefined })}
              >
                <option value="">Any (just get a reference)</option>
                {blueprints.map((bp) => (
                  <option key={bp.id} value={bp.id}>
                    {bp.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="node-field">
              <span>Target</span>
              <select
                value={node.data.targetObjectId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { targetObjectId: event.target.value || undefined })}
              >
                <option value="">Self (this object)</option>
                <option value="$player">Player</option>
                <option value="$trigger">Trigger toucher ($trigger)</option>
                {sceneObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
              <small className="node-hint">
                Continues only if the target runs the chosen blueprint; on success it becomes "$cast" for downstream Get/Set
                Object Var (Unreal-style Cast To &lt;Blueprint&gt;).
              </small>
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

        <button className="node-delete-button" onClick={() => deleteGraphNode(node.id)}>
          <Trash2 size={14} aria-hidden />
          <span>Delete node</span>
        </button>
      </div>

      <GraphDataLibrary />
    </aside>
  );
}

export function VisualScriptingPanel() {
  const graph = useEditorStore((state) => state.activeGraph());
  const blueprints = useEditorStore((state) => state.blueprints);
  const activeBlueprint = useEditorStore((state) => state.activeBlueprint());
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  // Stable list — only used for instance counts / pickers, must not re-render the graph during Play.
  const sceneObjects = useStableActiveObjects();
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const createBlueprint = useEditorStore((state) => state.createBlueprint);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const onConnect = useEditorStore((state) => state.onConnect);
  const addGraphNode = useEditorStore((state) => state.addGraphNode);
  const addGraphNodeToBlueprint = useEditorStore((state) => state.addGraphNodeToBlueprint);
  const variables = useEditorStore((state) => state.variables);
  const createVariable = useEditorStore((state) => state.createVariable);
  const deleteGraphNode = useEditorStore((state) => state.deleteGraphNode);
  const deleteGraphNodes = useEditorStore((state) => state.deleteGraphNodes);
  const pasteGraphNodes = useEditorStore((state) => state.pasteGraphNodes);
  const autoLayoutActiveGraph = useEditorStore((state) => state.autoLayoutActiveGraph);
  const selectedGraphNode = useEditorStore((state) => state.selectedGraphNode());
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const instanceCount = sceneObjects.filter((object) => object.script?.blueprintId === activeBlueprintId).length;
  const selectedNodeDetail = selectedGraphNode?.data.label ?? 'Blueprint Graph';

  const { screenToFlowPosition } = useReactFlow();
  const flowShellRef = useRef<HTMLDivElement | null>(null);
  // When the search menu was opened by dragging a wire into empty space, `pending` holds the socket the
  // drag started from, so picking a node auto-wires it (Unreal-style). null = opened via right-click.
  const [searchMenu, setSearchMenu] = useState<{
    x: number;
    y: number;
    pending?: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' };
  } | null>(null);
  // Set on connect-start, cleared by a successful onConnect; if still set at connect-end the drag landed
  // on empty canvas, which is our cue to open the node menu with that source connection pending.
  const connectingRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(
    null,
  );
  // Drives a class on the canvas while a wire is being dragged, so CSS can dim the incompatible ports
  // (exec can't connect to value): you instantly see where the wire can actually land.
  const [connectingKind, setConnectingKind] = useState<'exec' | 'value' | null>(null);
  // Multi-node clipboard: the copied nodes plus the wires running between them (other wires don't travel).
  const [clipboard, setClipboard] = useState<{ nodes: NodeForgeNode[]; edges: Edge[] } | null>(null);

  // Palette quick-filter: type to narrow the node list by name, description, or category.
  const [paletteFilter, setPaletteFilter] = useState('');
  const filteredNodeGroups = useMemo(() => {
    const query = paletteFilter.trim().toLowerCase();
    if (!query) return nodeGroups;
    return nodeGroups
      .map((group) => ({
        ...group,
        nodes: group.nodes.filter(
          (node) =>
            node.toLowerCase().includes(query) ||
            group.title.toLowerCase().includes(query) ||
            (nodeDescriptions[node] ?? '').toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.nodes.length > 0);
  }, [paletteFilter]);

  // Exec-flow visualization (Unreal-style): while Play runs with this editor open, the runtime marks
  // every exec node it runs (see runtime/execTrace); we poll that trace and pulse the nodes + wires
  // that executed within the last ~⅓ second.
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const [hotNodes, setHotNodes] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setExecTraceEnabled(isPlaying);
    if (!isPlaying) {
      setHotNodes((prev) => (prev.size ? new Set<string>() : prev));
      return () => setExecTraceEnabled(false);
    }
    const interval = window.setInterval(() => {
      const cutoff = performance.now() - 350;
      const next = new Set<string>();
      for (const [nodeId, at] of execTrace.nodes) if (at >= cutoff) next.add(nodeId);
      setHotNodes((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
    }, 150);
    return () => {
      window.clearInterval(interval);
      setExecTraceEnabled(false);
    };
  }, [isPlaying]);

  // Nodes fed to React Flow, tagged with the exec-hot pulse class while they're executing.
  const flowNodes = useMemo<NodeForgeNode[]>(
    () =>
      (hotNodes.size
        ? graph?.nodes.map((node) => (hotNodes.has(node.id) ? { ...node, className: 'exec-hot' } : node))
        : graph?.nodes) ?? [],
    [graph, hotNodes],
  );

  const nodeChoices = useMemo<NodeChoice[]>(
    () => [
      ...baseNodeChoices,
      ...variables.flatMap((variable) => [
        {
          label: `Get ${variable.name}`,
          category: 'Variables' as GraphNodeCategory,
          description: `Read ${variable.name} (${variable.type}).`,
          nodeKind: 'variable.get' as GraphNodeKind,
          valueType: variable.type,
          nodeLabel: 'Get Variable',
          data: { variableId: variable.id, valueType: variable.type },
        },
        {
          label: `Set ${variable.name}`,
          category: 'Variables' as GraphNodeCategory,
          description: `Write ${variable.name} (${variable.type}).`,
          nodeKind: 'variable.set' as GraphNodeKind,
          valueType: 'exec' as const,
          nodeLabel: 'Set Variable',
          data: { variableId: variable.id, valueType: variable.type },
        },
      ]),
    ],
    [variables],
  );

  const createVariableNode = (position?: { x: number; y: number }) => {
    const variableId = createVariable(undefined, 'number', true);
    const id = addGraphNodeToBlueprint(activeBlueprintId, 'Set Variable', 'Variables', { variableId }, position);
    selectGraphNode(id);
    return id;
  };

  const addNodeAt = (
    choice: NodeChoice,
    screen: { x: number; y: number; pending?: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' } },
  ) => {
    const position = screenToFlowPosition({ x: screen.x, y: screen.y });
    if (choice.action === 'create-variable' || choice.label === 'New Variable') {
      createVariableNode(position);
      setSearchMenu(null);
      return;
    }
    const id = addGraphNodeToBlueprint(activeBlueprintId, choice.nodeLabel ?? choice.label, choice.category, choice.data ?? {}, position);
    // Auto-wire the dragged-from socket to the new node (Unreal-style). Handle ids are uniform enough to do
    // this reliably for exec flow (exec-in/exec-out) and for feeding a value input from a new value node
    // (value-out). The one case we can't target generically — an output into an arbitrary value INPUT — just
    // drops the node unconnected.
    const pending = screen.pending;
    if (pending) {
      // Only wire a handle we KNOW the new node has, so we never leave a dangling edge: pure value nodes
      // (outputTypeOf defined) have `value-out` and no exec pins; everything else has exec-in/exec-out.
      const created = useEditorStore.getState().activeGraph()?.nodes.find((node) => node.id === id);
      const kind = created?.data.nodeKind as GraphNodeKind | undefined;
      const isValueNode = kind ? outputTypeOf[kind] !== undefined : false;
      const exec = (pending.handleId ?? '').startsWith('exec');
      let connection: Connection | null = null;
      if (pending.handleType === 'source') {
        // Dragged from an OUTPUT → into the new node's input. Exec into an action node's exec-in is the
        // reliable case; a value output into an arbitrary input handle can't be targeted generically.
        if (exec && !isValueNode) connection = { source: pending.nodeId, sourceHandle: pending.handleId, target: id, targetHandle: 'exec-in' };
      } else if (exec && !isValueNode) {
        // Dragged from an exec INPUT → drive it from the new action node's exec-out.
        connection = { source: id, sourceHandle: 'exec-out', target: pending.nodeId, targetHandle: pending.handleId };
      } else if (!exec && isValueNode) {
        // Dragged from a value INPUT → feed it from the new value node's value-out (the common "I need a value here").
        connection = { source: id, sourceHandle: 'value-out', target: pending.nodeId, targetHandle: pending.handleId };
      }
      if (connection) onConnect(connection);
    }
    selectGraphNode(id);
    setSearchMenu(null);
  };

  const addPaletteNode = (label: string, category: GraphNodeCategory) => {
    if (label === 'New Variable') {
      createVariableNode();
      return;
    }
    addGraphNode(label, category);
  };

  // Drag a palette entry onto the canvas to drop a node exactly where the cursor is.
  const onPaletteDragStart = (event: React.DragEvent, label: string, category: GraphNodeCategory) => {
    event.dataTransfer.setData('application/nodeforge', JSON.stringify({ label, category }));
    event.dataTransfer.effectAllowed = 'move';
  };
  const onCanvasDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('application/nodeforge')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };
  const onCanvasDrop = (event: React.DragEvent) => {
    const raw = event.dataTransfer.getData('application/nodeforge');
    if (!raw) return;
    event.preventDefault();
    const { label, category } = JSON.parse(raw) as { label: string; category: GraphNodeCategory };
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (label === 'New Variable') {
      createVariableNode(position);
      return;
    }
    const id = addGraphNodeToBlueprint(activeBlueprintId, label, category, {}, position);
    selectGraphNode(id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editableSel = 'input, textarea, select, [contenteditable="true"]';
      // Never treat a keystroke as a node command while a field is being edited — guard BOTH the event
      // target AND the currently-focused element (a number input can blur/commit between keystrokes, so
      // the next key's target may be the body even though the user is still mid-edit). This is what stops
      // Backspace/Delete from nuking the selected node while you're correcting a number in the inspector.
      if (target?.closest(editableSel)) return;
      if (document.activeElement?.closest(editableSel)) return;
      if (!flowShellRef.current?.contains(document.activeElement)) return;
      const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
      const isDelete = event.key === 'Delete' || event.key === 'Backspace';
      // The working set = every marquee/shift-selected node, falling back to the inspector's single selection.
      const selectedNodes = graph?.nodes.filter((node) => node.selected) ?? [];
      if (selectedGraphNode && !selectedNodes.some((node) => node.id === selectedGraphNode.id)) {
        selectedNodes.push(selectedGraphNode);
      }
      if (isCopy && selectedNodes.length && graph) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const ids = new Set(selectedNodes.map((node) => node.id));
        setClipboard({
          nodes: selectedNodes.map((node) => ({ ...node, selected: false, data: structuredClone(node.data) })),
          edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })),
        });
      }
      if (isPaste && clipboard) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const newIds = pasteGraphNodes(activeBlueprintId, clipboard.nodes, clipboard.edges);
        if (newIds[0]) selectGraphNode(newIds[0]);
        // Shift the stored clipboard so a repeated paste cascades instead of stacking in place.
        setClipboard({
          nodes: clipboard.nodes.map((node) => ({
            ...node,
            position: { x: node.position.x + 36, y: node.position.y + 36 },
          })),
          edges: clipboard.edges,
        });
      }
      if (isDelete && selectedNodes.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteGraphNodes(selectedNodes.map((node) => node.id));
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [activeBlueprintId, clipboard, deleteGraphNodes, graph, pasteGraphNodes, selectGraphNode, selectedGraphNode]);

  // Reject wires that cross categories (exec↔value) or loop a node back to itself.
  const isExecHandle = (handleId?: string | null) => (handleId ?? '').startsWith('exec');
  const isValidConnection = (connection: Connection | Edge) => {
    if (connection.source === connection.target) return false;
    return isExecHandle(connection.sourceHandle) === isExecHandle(connection.targetHandle);
  };

  // Drag-to-create: remember the socket a wire drag started from; clear it the moment a real connection
  // lands on another socket (onConnect fires first). If it's still set at connect-end, the wire was
  // dropped on empty canvas → open the node menu there with this socket pending so the pick auto-wires.
  const onConnectStart = (_event: unknown, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
    connectingRef.current = params.nodeId && params.handleType ? { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType } : null;
    setConnectingKind(isExecHandle(params.handleId) ? 'exec' : 'value');
  };
  const handleConnect = (connection: Connection) => {
    connectingRef.current = null;
    setConnectingKind(null);
    onConnect(connection);
  };
  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    const pending = connectingRef.current;
    connectingRef.current = null;
    setConnectingKind(null);
    if (!pending) return;
    const target = event.target as HTMLElement | null;
    if (!target?.classList?.contains('react-flow__pane')) return; // landed on a socket/node, not empty canvas
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    setSearchMenu({ x: point.clientX, y: point.clientY, pending });
  };

  // Color wires by what flows through them: neutral for exec, data-type hue for values.
  const styledEdges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    const typeByNode = new Map<string, GraphValueType | 'any'>();
    for (const node of graph.nodes) {
      typeByNode.set(node.id, outputTypeOf[node.data.nodeKind] ?? (node.data.valueType as GraphValueType | undefined) ?? 'any');
    }
    return graph.edges.map((edge) => {
      const exec = isExecHandle(edge.sourceHandle);
      // A wire pulses gold while both its endpoints executed within the trace window.
      const hot = exec && hotNodes.has(edge.source) && hotNodes.has(edge.target);
      const stroke = hot ? '#ffd34d' : exec ? EXEC_WIRE_COLOR : VALUE_TYPE_COLORS[typeByNode.get(edge.source) ?? 'any'];
      return { ...edge, style: { ...edge.style, stroke, strokeWidth: hot ? 3 : 2 } };
    });
  }, [graph, hotNodes]);

  if (!graph || !activeBlueprint) {
    return (
      <section className="panel scripting-panel">
        <div className="empty-state">
          <Waypoints size={22} aria-hidden />
          <span>No Blueprint open</span>
          <small>Double-click an object in the Hierarchy to edit its visual script, or select one that already has a Blueprint.</small>
        </div>
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
            <LayoutGrid size={14} aria-hidden />
          </button>
          <button className="icon-button compact" title="Create reusable Blueprint" onClick={createBlueprint}>
            <Plus size={14} aria-hidden />
          </button>
        </div>
      </div>

      <div className="scripting-body">
        <aside className="node-palette">
          <div className="blueprint-card graph-overview-card">
            <div>
              <strong>{activeBlueprint.name}</strong>
              <span>{activeBlueprint.description}</span>
            </div>
            <div className="graph-overview-stats">
              <span>{graph.nodes.length} nodes</span>
              <span>{graph.edges.length} wires</span>
            </div>
          </div>
          <label className="search-field palette-search">
            <Search size={14} aria-hidden />
            <input
              value={paletteFilter}
              onChange={(event) => setPaletteFilter(event.target.value)}
              placeholder="Search nodes…"
              spellCheck={false}
            />
          </label>
          {filteredNodeGroups.length === 0 && (
            <div className="empty-state compact">No nodes match “{paletteFilter}”</div>
          )}
          {filteredNodeGroups.map(({ title, icon: Icon, nodes }) => (
            <PaletteGroup key={title} title={title} icon={Icon} count={nodes.length} forceOpen={paletteFilter.trim() !== ''}>
              {nodes.map((node) => (
                <button
                  key={node}
                  draggable
                  onDragStart={(event) => onPaletteDragStart(event, node, title)}
                  onClick={() => addPaletteNode(node, title)}
                  title={`Add ${node} (or drag onto the canvas)`}
                >
                  <span className="node-palette-icon">
                    <Plus size={12} aria-hidden />
                  </span>
                  <span className="node-palette-copy">
                    <span>{node}</span>
                    <small>{nodeDescriptions[node] ?? `${title} node`}</small>
                  </span>
                </button>
              ))}
            </PaletteGroup>
          ))}
        </aside>

        <div
          className={connectingKind ? `flow-shell connecting-from-${connectingKind}` : 'flow-shell'}
          ref={flowShellRef}
          tabIndex={0}
          // Capture-phase: runs before ReactFlow's own pointer handlers, so node
          // selection works reliably even inside the docked panel. ReactFlow tags
          // each node wrapper with data-id.
          onPointerDown={() => flowShellRef.current?.focus()}
          onClickCapture={(event) => {
            const nodeEl = (event.target as HTMLElement).closest('.react-flow__node');
            const id = nodeEl?.getAttribute('data-id');
            if (id) selectGraphNode(id);
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            setSearchMenu({ x: event.clientX, y: event.clientY });
          }}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          <div className="flow-hud" aria-hidden>
            <span>{selectedNodeDetail}</span>
            <small>
              {graph.nodes.length} nodes / {graph.edges.length} wires
              {clipboard ? ` / ${clipboard.nodes.length} copied` : ''} · Shift+drag to box-select
            </small>
          </div>
          <ReactFlow
            nodes={flowNodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            edgesFocusable
            edgesReconnectable
            onNodeClick={(_, node) => selectGraphNode(node.id)}
            onEdgeDoubleClick={(event, edge) => {
              event.stopPropagation();
              onEdgesChange([{ id: edge.id, type: 'remove' }]);
            }}
            onSelectionChange={({ nodes }) => {
              // Only ADOPT an actual selection here — never clear on an empty event. Editing a node's
              // fields in the inspector replaces the nodes array, and because we don't persist React Flow's
              // `selected` flag, React Flow momentarily reports an empty selection; clearing on that would
              // deselect the node and close the inspector mid-edit. Real deselection is handled by onPaneClick.
              const id = nodes[0]?.id;
              if (id && id !== selectedGraphNode?.id) selectGraphNode(id);
            }}
            onPaneClick={() => {
              selectGraphNode(undefined);
              setSearchMenu(null);
            }}
            deleteKeyCode={[]}
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
        </div>
        <NodeInspector node={selectedGraphNode} />
      </div>

      {searchMenu && (
        <NodeSearchMenu
          x={searchMenu.x}
          y={searchMenu.y}
          choices={nodeChoices}
          onPick={(choice) => addNodeAt(choice, searchMenu)}
          onClose={() => setSearchMenu(null)}
        />
      )}
    </section>
  );
}
