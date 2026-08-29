import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useReactFlow, type Connection, type Edge, type NodeTypes } from '@xyflow/react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Download,
  FolderOpen,
  Focus,
  GitBranch,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  Unlink,
  Waypoints,
  Zap,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useSceneOptions, useStableActiveObjects, useStableActiveScene } from '../store/stableSelectors';
import { nodeDescriptions, nodeKindByLabel } from '../store/editor/graph';
import {
  NodeForgeGraphNode,
  outputTypeOf,
  outputTypeForHandle,
  inputTypeForHandle,
  valueTypesCompatible,
  valueProducerKinds,
  valueInputsFor,
  VALUE_TYPE_COLORS,
  EXEC_WIRE_COLOR,
} from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import { PaletteGroup } from './PaletteGroup';
import type { GraphNodeCategory, GraphNodeKind, GraphValue, GraphValueType, NodeForgeNode, NodeForgeNodeData, QualityLevel, UIElement, Vector3Tuple } from '../types';
import { QUALITY_LEVELS } from '../three/quality';
import { KEY_CODE_OPTIONS, keyLabelByCode } from '../utils/keyboardCodes';
import { execTrace, setExecTraceEnabled, resetExecWindowCounts } from '../runtime/execTrace';
import { valueTrace, setValueTraceEnabled, formatTraceValue } from '../runtime/valueTrace';
import { FEATHER_SIDEBAR_API, getFeatherCompletions, type FeatherApiEntry, type FeatherCompletion } from '../scripting/featherApi';
import { compileFeatherScriptToGraph } from '../scripting/featherCompiler';
import { parseFeatherScript, type FeatherDiagnostic } from '../scripting/featherParser';
import { isBlockingFeatherWarning } from '../scripting/featherDiagnostics';
import { graphToFeatherScript } from '../scripting/featherScript';
import { BEHAVIOR_PRESETS } from '../project/behaviors';
import { confirmAction } from '../store/confirmStore';
import { useProjectStore } from '../store/projectStore';
import { useFeatherExternalStore } from '../store/featherExternalStore';
import { TimelineCurveEditor } from './TimelineCurveEditor';
import { timelineCurvePreset } from '../runtime/timelineCurve';
import {
  isWorkspacePanelMaximized,
  onWorkspacePanelMaximizedChange,
  toggleWorkspacePanelMaximized,
} from './workspacePanels';
import { useCollaborationStore } from '../store/collaborationStore';
import { collaboratorsInBlueprint } from '../collaboration/presence';
import { CollaboratorAvatars } from './CollaboratorAvatars';

const nodeTypes: NodeTypes = {
  nodeforge: NodeForgeGraphNode,
};

const defaultEdgeOptions = { animated: false, type: 'smoothstep', interactionWidth: 28 } as const;
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
    nodes: ['Start', 'Update', 'Key Down', 'Key Up', 'Custom Event', 'Collision Enter', 'Collision Stay', 'Collision Exit', 'Trigger Enter', 'Trigger Stay', 'Trigger Exit', 'Interact', 'On Receive Damage', 'On Land', 'Timer'],
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
      'Vector Length',
      'Dot Product',
      'Map Range',
      'Floor',
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
    nodes: ['Translate', 'Rotate', 'Get Position', 'Set Position', 'Get Rotation', 'Set Rotation', 'Get Scale', 'Set Scale', 'Timeline', 'Timeline Control', 'Look At', 'Get Move Input', 'Move', 'Move To', 'Jump', 'Get Drive Input', 'Drive', 'Enter Vehicle', 'Exit Vehicle', 'Get Vehicle Speed', 'Is Grounded', 'Raycast', 'Set Camera', 'Set Ragdoll', 'Spawn Projectile', 'Spawn Prefab', 'Spawn Attached', 'Set Visible', 'Set Active', 'Burst Particles', 'Set Particles Emitting', 'Spawn Particle System', 'Camera Shake', 'Screen Flash', 'Screen Fade', 'Spawn Decal', 'Explode', 'Set Environment', 'Get Time Of Day', 'Set Time Of Day', 'Apply Damage', 'Set Quality', 'Set Time Scale', 'Start Replay', 'Fire Event', 'Play Cinematic', 'Spawn Object', 'Load Scene', 'Destroy Object', 'Play Sound', 'Set Material Color', 'Set Material Property', 'Get Material Color', 'Get Material Property', 'Set Anim Float', 'Set Anim Bool', 'Set Anim Trigger', 'Play Animation', 'Set Movement Mode', 'Get Anim Param', 'Get Anim State', 'Find Actor By Blueprint', 'Find Actor By Tag', 'Distance To Player', 'Direction To Player', 'Player Location', 'Has Line Of Sight', 'Face Player', 'Print'],
  },
  {
    title: 'Physics',
    icon: Boxes,
    nodes: ['Apply Force', 'Apply Impulse', 'Apply Force at Point', 'Apply Torque', 'Set Physics', 'Set Velocity', 'Get Velocity', 'Get Speed', 'Set Angular Velocity', 'Get Angular Velocity', 'Set Gravity', 'Overlap Sphere', 'Sphere Cast', 'Set Joint Motor', 'Cut Cable', 'Set Cable Length', 'Get Cable Tension', 'Fracture'],
  },
  {
    title: 'Persistence',
    icon: Save,
    nodes: ['Save Game', 'Load Game', 'Clear Save', 'Has Save'],
  },
  {
    title: 'UI',
    icon: LayoutDashboard,
    nodes: ['Show UI', 'Hide UI', 'Toggle UI', 'Set UI Text', 'Set UI Visible'],
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

const starterBehaviorIds = ['rotating-prop', 'collectible', 'door-on-interact', 'moving-platform', 'chase-player', 'health-and-death'];
const starterBehaviors = starterBehaviorIds.flatMap((id) => {
  const preset = BEHAVIOR_PRESETS.find((candidate) => candidate.id === id);
  return preset ? [preset] : [];
});

const essentialNodes: Array<{ label: string; category: GraphNodeCategory }> = [
  { label: 'Print', category: 'Runtime' },
  { label: 'Translate', category: 'Runtime' },
  { label: 'Rotate', category: 'Runtime' },
  { label: 'Branch', category: 'Logic' },
  { label: 'Collision Enter', category: 'Events' },
  { label: 'Key Down', category: 'Events' },
];

const handleTabListKeyDown = (
  event: ReactKeyboardEvent<HTMLDivElement>,
  values: string[],
  activeValue: string,
  onSelect: (value: string) => boolean | void,
) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(activeValue));
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? values.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % values.length
          : (currentIndex - 1 + values.length) % values.length;
  const nextValue = values[nextIndex];
  if (onSelect(nextValue) === false) return;
  const tabList = event.currentTarget;
  window.requestAnimationFrame(() => {
    tabList.querySelector<HTMLButtonElement>(`[role="tab"][data-tab-value="${nextValue}"]`)?.focus();
  });
};

const featherFileName = (name: string) => {
  const base = name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'Blueprint';
  return `${base}.feather`;
};

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
  { key: 'dayCycleEnabled', label: 'Day Cycle', type: 'boolean' },
  { key: 'dayCycleDuration', label: 'Day Length (s)', type: 'number', step: 30, min: 30 },
  { key: 'dayCycleTime', label: 'Time Of Day', type: 'number', step: 0.01, min: 0 },
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
  label = 'Value',
  onChange,
}: {
  type: GraphValueType;
  value: GraphValue | undefined;
  label?: string;
  onChange: (value: GraphValue) => void;
}) {
  if (type === 'number') {
    return (
      <input
        type="number"
        aria-label={label}
        step="0.1"
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <select aria-label={label} value={value ? 'true' : 'false'} onChange={(event) => onChange(event.target.value === 'true')}>
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
              aria-label={`${label} ${axis}`}
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

  return <input aria-label={label} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
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
    <div className="graph-library" aria-label="Graph data library">
      <section>
        <h3 className="library-heading">
          <span>Global Variables</span>
          <button title="Create a global (shared) variable" aria-label="Create a global variable" onClick={() => createVariable()}>
            <Plus size={14} aria-hidden />
          </button>
        </h3>
        <small className="node-hint">
          SHARED across the whole game (one value for everything) — use for score, settings, Save Game. For per-object
          state (per-player gold, per-enemy health) use Instance Variables below instead.
        </small>

        {variables.map((variable) => (
          <div className="library-card" key={variable.id}>
            <div className="library-row">
              <input aria-label="Global variable name" value={variable.name} onChange={(event) => updateVariable(variable.id, { name: event.target.value })} />
              <button title="Delete variable" aria-label={`Delete global variable ${variable.name}`} onClick={() => deleteVariable(variable.id)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            <div className="library-row two">
              <select
                aria-label={`Type for global variable ${variable.name}`}
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
                  aria-label={`Save global variable ${variable.name}`}
                  checked={variable.persistent}
                  onChange={(event) => updateVariable(variable.id, { persistent: event.target.checked })}
                />
                <span>Save</span>
              </label>
            </div>
            <ValueEditor
              type={variable.type}
              value={variable.defaultValue}
              label={`Default value for global variable ${variable.name}`}
              onChange={(defaultValue) => updateVariable(variable.id, { defaultValue })}
            />
          </div>
        ))}
      </section>

      <section>
        <h3 className="library-heading">
          <span>Instance Variables{activeBlueprint ? ` · ${activeBlueprint.name}` : ''}</span>
          <button
            title={activeBlueprint ? 'Declare a per-instance variable on this blueprint' : 'Open a blueprint first'}
            aria-label={activeBlueprint ? `Create an instance variable for ${activeBlueprint.name}` : 'Open a blueprint to create an instance variable'}
            disabled={!activeBlueprint}
            onClick={() => activeBlueprint && addBlueprintVariable(activeBlueprint.id)}
          >
            <Plus size={14} aria-hidden />
          </button>
        </h3>
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
                  aria-label="Instance variable name"
                  value={variable.name}
                  onChange={(event) => updateBlueprintVariable(activeBlueprint.id, variable.id, { name: event.target.value })}
                />
                <button title="Delete instance variable" aria-label={`Delete instance variable ${variable.name}`} onClick={() => removeBlueprintVariable(activeBlueprint.id, variable.id)}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <div className="library-row two">
                <select
                  aria-label={`Type for instance variable ${variable.name}`}
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
                label={`Default value for instance variable ${variable.name}`}
                onChange={(defaultValue) => updateBlueprintVariable(activeBlueprint.id, variable.id, { defaultValue })}
              />
            </div>
          ))}
      </section>

      <section>
        <h3 className="library-heading">
          <span>Data Assets</span>
          <button title="Create Data Asset" aria-label="Create a data asset" onClick={() => createDataAsset()}>
            <Plus size={14} aria-hidden />
          </button>
        </h3>

        {dataAssets.map((table) => (
          <div className="library-card data-table-card" key={table.id}>
            <div className="library-row">
              <input aria-label="Data asset name" value={table.name} onChange={(event) => renameDataAsset(table.id, event.target.value)} />
              <button title="Delete Data Asset" aria-label={`Delete data asset ${table.name}`} onClick={() => deleteDataAsset(table.id)}>
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
                    aria-label={`Column name in ${table.name}`}
                    value={column.name}
                    onChange={(event) => updateDataAssetColumn(table.id, column.id, { name: event.target.value })}
                  />
                  <select
                    aria-label={`Type for column ${column.name}`}
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
                  <button title="Delete column" aria-label={`Delete column ${column.name}`} onClick={() => deleteDataAssetColumn(table.id, column.id)}>
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              ))}
            </div>

            <div className="table-rows">
              {table.rows.map((row) => (
                <div key={row.id} className="table-row-editor">
                  <div className="library-row">
                    <input aria-label={`Row key in ${table.name}`} value={row.key} onChange={(event) => updateDataAssetRow(table.id, row.id, { key: event.target.value })} />
                    <button title="Delete row" aria-label={`Delete row ${row.key || 'without a key'}`} onClick={() => deleteDataAssetRow(table.id, row.id)}>
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                  {table.columns.map((column) => (
                    <label key={column.id} className="table-cell-editor">
                      <span>{column.name}</span>
                      <ValueEditor
                        type={column.type}
                        value={row.values[column.id]}
                        label={`${column.name} value for row ${row.key || 'without a key'}`}
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
  const onConnect = useEditorStore((state) => state.onConnect);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
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
  const timelineDefinitions =
    activeGraph?.nodes.filter((candidate) => candidate.data.nodeKind === 'action.tweenProperty' && candidate.data.tweenCurve?.length) ?? [];
  // Stable subscriptions: the raw scene/scenes/objects references are replaced EVERY Play tick, which
  // re-rendered this whole xyflow graph 60×/s — the single biggest panel cost in the perf profiler.
  const activeScene = useStableActiveScene();
  const scenes = useSceneOptions();
  const sceneObjects = useStableActiveObjects();
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const isAnimNode = Boolean(node?.data.nodeKind.startsWith('animator.'));
  const [keyboardConnectionTarget, setKeyboardConnectionTarget] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');

  useEffect(() => {
    setKeyboardConnectionTarget('');
    setConnectionMessage('');
  }, [node?.id]);

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
        <aside className="graph-inspector" aria-label="Node details and graph data">
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
    node.data.nodeKind === 'action.applyImpulse' ||
    node.data.nodeKind === 'action.applyForceAtPoint' ||
    node.data.nodeKind === 'action.applyTorque' ||
    node.data.nodeKind === 'action.setAngularVelocity';
  const updatesImpulseSpace = node.data.nodeKind === 'action.applyImpulse' || node.data.nodeKind === 'action.applyForceAtPoint';
  const updatesLocalPoint = node.data.nodeKind === 'action.applyForceAtPoint';
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
    node.data.nodeKind === 'action.setTimeScale' ||
    node.data.nodeKind === 'action.setTimeOfDay';
  const updatesParamName =
    node.data.nodeKind === 'animator.setFloat' ||
    node.data.nodeKind === 'animator.setBool' ||
    node.data.nodeKind === 'animator.setTrigger' ||
    node.data.nodeKind === 'animator.getParam';
  const updatesStringValue = node.data.nodeKind === 'value.string';
  const updatesVectorValue =
    node.data.nodeKind === 'value.vector3' ||
    node.data.nodeKind === 'action.spawnParticleSystem' ||
    node.data.nodeKind === 'action.setGravity';
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
    node.data.nodeKind === 'ui.show' ||
    node.data.nodeKind === 'ui.hide' ||
    node.data.nodeKind === 'ui.toggle' ||
    node.data.nodeKind === 'ui.setText' ||
    node.data.nodeKind === 'ui.setVisible';
  const updatesUIElement = node.data.nodeKind === 'ui.setText' || node.data.nodeKind === 'ui.setVisible';
  const updatesObjectKey =
    node.data.nodeKind === 'variable.getObject' || node.data.nodeKind === 'variable.setObject';
  const updatesRandom = node.data.nodeKind === 'value.random';
  const updatesLoop = node.data.nodeKind === 'logic.forLoop';
  const updatesLoadScene = node.data.nodeKind === 'action.loadScene';
  const updatesCameraShake = node.data.nodeKind === 'action.cameraShake';
  const updatesScreenFlash = node.data.nodeKind === 'action.screenFlash';
  const updatesScreenFade = node.data.nodeKind === 'action.screenFade';
  const updatesExplode = node.data.nodeKind === 'action.explode';
  const updatesSpawnDecal = node.data.nodeKind === 'action.spawnDecal';
  const isReceiveDamage = node.data.nodeKind === 'event.receiveDamage';
  const updatesQuality = node.data.nodeKind === 'action.setQuality';
  const updatesEnvironment = node.data.nodeKind === 'action.setEnvironment';
  const updatesPhysics = node.data.nodeKind === 'action.setPhysics';
  const updatesMoveTo = node.data.nodeKind === 'action.moveTo';
  const updatesTween = node.data.nodeKind === 'action.tweenProperty';
  const updatesTimelineControl = node.data.nodeKind === 'action.timelineControl';
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
    node.data.nodeKind === 'event.collisionStay' ||
    node.data.nodeKind === 'event.triggerEnter' ||
    node.data.nodeKind === 'event.triggerExit' ||
    node.data.nodeKind === 'event.triggerStay';
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
  const isValueConnectionSource = valueProducerKinds.has(node.data.nodeKind);
  const connectionSourceType =
    outputTypeOf[node.data.nodeKind] ?? (node.data.valueType as GraphValueType | undefined) ?? 'any';
  const existingConnections = activeGraph?.edges.filter((edge) => edge.source === node.id || edge.target === node.id) ?? [];
  const keyboardConnectionOptions = activeGraph
    ? isValueConnectionSource
      ? activeGraph.nodes.flatMap((candidate) =>
          candidate.id === node.id
            ? []
            : valueInputsFor(candidate.data.nodeKind)
                .filter((input) =>
                  valueTypesCompatible(
                    connectionSourceType,
                    inputTypeForHandle(
                      candidate.data.nodeKind,
                      input.id,
                      candidate.data.valueType as GraphValueType | undefined,
                    ),
                  ),
                )
                .filter(
                  (input) =>
                    !activeGraph.edges.some(
                      (edge) =>
                        edge.source === node.id &&
                        edge.sourceHandle === 'value-out' &&
                        edge.target === candidate.id &&
                        edge.targetHandle === input.id,
                    ),
                )
                .map((input) => ({
                  value: JSON.stringify([candidate.id, input.id]),
                  label: `${candidate.data.label} · ${input.label}`,
                })),
        )
      : node.data.hasOutput === false
        ? []
        : activeGraph.nodes
            .filter(
              (candidate) =>
                candidate.id !== node.id &&
                candidate.data.hasInput !== false &&
                !valueProducerKinds.has(candidate.data.nodeKind) &&
                !activeGraph.edges.some(
                  (edge) =>
                    edge.source === node.id &&
                    edge.sourceHandle === 'exec-out' &&
                    edge.target === candidate.id &&
                    edge.targetHandle === 'exec-in',
                ),
            )
            .map((candidate) => ({
              value: JSON.stringify([candidate.id, 'exec-in']),
              label: candidate.data.label,
            }))
    : [];

  const connectWithKeyboard = () => {
    if (!keyboardConnectionTarget) return;
    const [target, targetHandle] = JSON.parse(keyboardConnectionTarget) as [string, string];
    onConnect({
      source: node.id,
      sourceHandle: isValueConnectionSource ? 'value-out' : 'exec-out',
      target,
      targetHandle,
    });
    const targetNode = activeGraph?.nodes.find((candidate) => candidate.id === target);
    setKeyboardConnectionTarget('');
    setConnectionMessage(`Connected ${node.data.label} to ${targetNode?.data.label ?? 'the selected node'}.`);
  };

  return (
    <aside className="graph-inspector" aria-label={`Details for ${node.data.label}`}>
      <div className="graph-inspector-header">
        <span className="eyebrow">Node Inspector</span>
        <h3>{node.data.label}</h3>
      </div>

      <div className="node-inspector-body">
        <label className="node-field">
          <span>Kind</span>
          <input value={node.data.nodeKind} readOnly />
        </label>
        <a className="node-connection-skip" href="#node-connection-editor">
          Jump to connections
        </a>

        {updatesNodeKey && (
          <label className="node-field">
            <span>Key</span>
            <select
              aria-label="Preset key"
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
              aria-label="Custom keyboard or mouse code"
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
                      : node.data.nodeKind === 'action.setTimeOfDay'
                        ? 'Time of day (0 midnight · 0.25 sunrise · 0.5 noon)'
                      : 'Number'}
            </span>
            <input
              type="number"
              step="0.1"
              value={
                node.data.nodeKind === 'action.setTimeOfDay'
                  ? (node.data.timeOfDay ?? node.data.numberValue ?? 0.35)
                  : (node.data.numberValue ?? 0)
              }
              onChange={(event) =>
                node.data.nodeKind === 'action.setTimeOfDay'
                  ? updateGraphNodeData(node.id, { timeOfDay: Number(event.target.value), numberValue: Number(event.target.value) })
                  : updateGraphNodeData(node.id, { numberValue: Number(event.target.value) })
              }
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

        {updatesScreenFlash && (
          <>
            <label className="node-field">
              <span>Flash amount</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={node.data.flashAmount ?? 0.7}
                onChange={(event) => updateGraphNodeData(node.id, { flashAmount: Math.max(0, Math.min(1, Number(event.target.value))) })}
              />
              <small className="node-hint">Peak opacity 0–1 of a full-screen pop, fades in ~0.3s. Wire a number into “amount” to drive it live.</small>
            </label>
            <label className="node-field">
              <span>Flash color</span>
              <input
                type="color"
                value={node.data.flashColor ?? '#ffffff'}
                onChange={(event) => updateGraphNodeData(node.id, { flashColor: event.target.value })}
              />
              <small className="node-hint">White = neutral bloom; hot orange for blasts; red for damage.</small>
            </label>
          </>
        )}

        {updatesScreenFade && (
          <>
            <label className="node-field">
              <span>Fade to</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={node.data.fadeTo ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { fadeTo: Math.max(0, Math.min(1, Number(event.target.value))) })}
              />
              <small className="node-hint">Target opacity 0 (clear) … 1 (fully covered). Wire To / Duration pins to drive live.</small>
            </label>
            <label className="node-field">
              <span>Duration (s)</span>
              <input
                type="number"
                step="0.05"
                min="0"
                value={node.data.numberValue ?? 0.5}
                onChange={(event) => updateGraphNodeData(node.id, { numberValue: Math.max(0, Number(event.target.value)) })}
              />
            </label>
            <label className="node-field">
              <span>Color</span>
              <input
                type="color"
                value={node.data.fadeColor ?? '#000000'}
                onChange={(event) => updateGraphNodeData(node.id, { fadeColor: event.target.value })}
              />
            </label>
            <label className="node-field">
              <span>Fade from (optional)</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={node.data.fadeFrom ?? ''}
                placeholder="current"
                onChange={(event) => {
                  const raw = event.target.value;
                  updateGraphNodeData(node.id, { fadeFrom: raw === '' ? undefined : Math.max(0, Math.min(1, Number(raw))) });
                }}
              />
              <small className="node-hint">Leave empty to start from the current fade opacity. Done fires when the lerp settles.</small>
            </label>
          </>
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

        {updatesSpawnDecal && (
          <>
            <label className="node-field">
              <span>Kind</span>
              <select
                value={node.data.decalKind ?? 'bullet'}
                onChange={(event) => updateGraphNodeData(node.id, { decalKind: event.target.value as 'bullet' | 'blood' | 'scorch' })}
              >
                <option value="bullet">Bullet hole</option>
                <option value="blood">Blood splat</option>
                <option value="scorch">Scorch / burn</option>
              </select>
              <small className="node-hint">Wire a hit Point → Location and a surface Normal → Normal (e.g. from a Raycast/Sphere Cast). Unwired uses self position + up.</small>
            </label>
            <label className="node-field">
              <span>Size</span>
              <input type="number" step="0.05" min="0.02" value={node.data.decalSize ?? 0.4}
                onChange={(event) => updateGraphNodeData(node.id, { decalSize: Math.max(0.02, Number(event.target.value)) })} />
              <small className="node-hint">Half-width in world units. Or wire a number into the Size input.</small>
            </label>
            <label className="node-field">
              <span>Life (s)</span>
              <input type="number" step="0.5" min="0" value={node.data.decalLife ?? 0}
                onChange={(event) => updateGraphNodeData(node.id, { decalLife: Math.max(0, Number(event.target.value)) })} />
              <small className="node-hint">Seconds before it fades. 0 = permanent (recycled by the pool after a cap).</small>
            </label>
            <label className="node-field">
              <span>Tint</span>
              <input type="color" value={node.data.decalColor ?? '#ffffff'}
                onChange={(event) => updateGraphNodeData(node.id, { decalColor: event.target.value })} />
              <small className="node-hint">Optional color multiply over the preset (leave white for the default look).</small>
            </label>
          </>
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
            <div className="node-field-group-title">Timeline transform</div>
            {node.data.tweenCurve?.length ? (
              <label className="node-field">
                <span>Timeline name</span>
                <input
                  aria-label="Timeline name"
                  value={node.data.timelineName ?? 'Timeline'}
                  onChange={(event) => updateGraphNodeData(node.id, { timelineName: event.target.value || 'Timeline' })}
                />
                <small className="node-hint">
                  Rename freely; controls keep using the stable id <code>{node.data.timelineId || node.id}</code>.
                </small>
              </label>
            ) : null}
            <label className="node-field">
              <span>Property</span>
              <select
                value={node.data.tweenProperty ?? 'position'}
                onChange={(event) => {
                  const tweenProperty = event.target.value as 'position' | 'rotation' | 'scale';
                  updateGraphNodeData(node.id, {
                    tweenProperty,
                    vectorValue:
                      tweenProperty === 'rotation'
                        ? [0, 90, 0]
                        : tweenProperty === 'scale'
                          ? node.data.tweenValueMode === 'relative'
                            ? [1.2, 1.2, 1.2]
                            : [1, 1, 1]
                          : [0, 1, 0],
                  });
                }}
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
              <small className="node-hint">
                {node.data.tweenValueMode === 'relative'
                  ? node.data.tweenProperty === 'scale'
                    ? 'Scale multiplier from the captured start. A wired Vector3 overrides this.'
                    : `Offset from the captured start in ${node.data.tweenSpace ?? 'local'} space. Rotation uses degrees.`
                  : `Absolute end value in ${node.data.tweenSpace ?? 'local'} space. Rotation uses degrees.`}
              </small>
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
              <span>Space</span>
              <select
                value={node.data.tweenSpace ?? 'local'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, { tweenSpace: event.target.value as 'local' | 'world' })
                }
              >
                <option value="local">Local / parent space</option>
                <option value="world">World space</option>
              </select>
            </label>
            <label className="node-field">
              <span>Values</span>
              <select
                value={node.data.tweenValueMode ?? 'absolute'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, { tweenValueMode: event.target.value as 'absolute' | 'relative' })
                }
              >
                <option value="relative">Relative to start</option>
                <option value="absolute">Absolute</option>
              </select>
            </label>
            <label className="node-field row">
              <span>Loop</span>
              <input type="checkbox" checked={node.data.tweenLoop ?? false} onChange={(event) => updateGraphNodeData(node.id, { tweenLoop: event.target.checked })} />
            </label>
            {node.data.tweenLoop && (
              <label className="node-field row">
                <span>Ping-pong</span>
                <input type="checkbox" checked={node.data.tweenPingPong ?? false} onChange={(event) => updateGraphNodeData(node.id, { tweenPingPong: event.target.checked })} />
              </label>
            )}
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
              <small className="node-hint">Whose transform animates. Then continues immediately; Update fires every frame and Finished fires once for non-looping playback.</small>
            </label>
            <div className="node-field-group-title">Value curve</div>
            {node.data.tweenCurve ? (
              <TimelineCurveEditor
                value={node.data.tweenCurve}
                onChange={(tweenCurve) => updateGraphNodeData(node.id, { tweenCurve })}
              />
            ) : (
              <>
                <label className="node-field">
                  <span>Legacy easing</span>
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
                <button className="full-button primary" type="button" onClick={() => updateGraphNodeData(node.id, { tweenCurve: timelineCurvePreset('smooth') })}>
                  Edit as curve Timeline
                </button>
              </>
            )}
          </>
        )}

        {updatesTimelineControl && (
          <>
            <div className="node-field-group-title">Timeline playback</div>
            <label className="node-field">
              <span>Timeline</span>
              <select
                aria-label="Timeline to control"
                value={node.data.timelineRefId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { timelineRefId: event.target.value || undefined })}
              >
                <option value="">Choose a Timeline…</option>
                {node.data.timelineRefId &&
                !timelineDefinitions.some((timeline) => (timeline.data.timelineId || timeline.id) === node.data.timelineRefId) ? (
                  <option value={node.data.timelineRefId}>Missing Timeline ({node.data.timelineRefId})</option>
                ) : null}
                {timelineDefinitions.map((timeline) => {
                  const timelineId = timeline.data.timelineId || timeline.id;
                  return (
                    <option key={timeline.id} value={timelineId}>
                      {timeline.data.timelineName || 'Timeline'}
                    </option>
                  );
                })}
              </select>
              <small className="node-hint">Only Timelines in this Blueprint appear here. Each placed Blueprint instance plays independently.</small>
            </label>
            <label className="node-field">
              <span>Command</span>
              <select
                aria-label="Timeline command"
                value={node.data.timelineCommand ?? 'play'}
                onChange={(event) =>
                  updateGraphNodeData(node.id, {
                    timelineCommand: event.target.value as 'play' | 'restart' | 'reverse' | 'stop',
                  })
                }
              >
                <option value="play">Play / resume forward</option>
                <option value="restart">Restart from beginning</option>
                <option value="reverse">Reverse from current time</option>
                <option value="stop">Stop and hold</option>
              </select>
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
              label={node.data.nodeKind === 'action.spawnParticleSystem' ? 'Offset' : 'Vector'}
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
                  label={`Fallback value for ${selectedInstanceVar?.name ?? selectedVariable?.name ?? 'variable'}`}
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
                    : node.data.nodeKind === 'action.applyImpulse' || node.data.nodeKind === 'action.applyForceAtPoint'
                      ? 'Impulse'
                    : 'Units / sec'}
              </span>
              <input
                type="number"
                step="0.1"
                value={node.data.amount ?? (node.data.nodeKind === 'action.rotate' ? 90 : node.data.nodeKind === 'action.applyForce' || node.data.nodeKind === 'action.applyImpulse' || node.data.nodeKind === 'action.applyForceAtPoint' ? 8 : -3.6)}
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

        {updatesLocalPoint && (
          <label className="node-field">
            <span>Local Point</span>
            <div className="vec-inline">
              {([0, 1, 2] as const).map((axis) => (
                <input
                  key={axis}
                  type="number"
                  step="0.1"
                  value={Number((node.data.localPoint ?? [0, 0, 0])[axis] ?? 0)}
                  onChange={(event) => {
                    const next = [...(node.data.localPoint ?? [0, 0, 0])] as Vector3Tuple;
                    next[axis] = Number(event.target.value);
                    updateGraphNodeData(node.id, { localPoint: next });
                  }}
                />
              ))}
            </div>
            <small className="node-hint">Where on the body (in its local axes) the impulse lands. Off-center = push + spin; [0,0,0] is a pure shove. A wired Vector3 overrides this.</small>
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
          <>
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
            <label className="node-field">
              <span>Volume</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={node.data.soundVolume ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { soundVolume: Math.max(0, Math.min(1, Number(event.target.value))) })}
              />
            </label>
            <label className="node-field">
              <span>Pitch</span>
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="4"
                value={node.data.soundPitch ?? 1}
                onChange={(event) => updateGraphNodeData(node.id, { soundPitch: Math.max(0.1, Math.min(4, Number(event.target.value))) })}
              />
            </label>
            <label className="node-field">
              <span>Pitch jitter</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={node.data.pitchJitter ?? 0}
                onChange={(event) => updateGraphNodeData(node.id, { pitchJitter: Math.max(0, Math.min(1, Number(event.target.value))) })}
              />
              <small className="node-hint">Randomize pitch ± this fraction each play (0.1–0.2 keeps repeated impacts fresh).</small>
            </label>
          </>
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
            {node.data.nodeKind === 'ui.setText' && (
              <small className="node-hint">Wire a value into the Text input, or set a literal String node.</small>
            )}
          </label>
        )}

        {node.data.nodeKind === 'ui.setVisible' && (
          <label className="node-field">
            <span>Visible</span>
            <input
              type="checkbox"
              checked={node.data.visible !== false}
              onChange={(event) => updateGraphNodeData(node.id, { visible: event.target.checked })}
            />
            <small className="node-hint">Or wire a boolean into the Visible pin.</small>
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

        <section id="node-connection-editor" className="node-connection-editor" aria-labelledby="node-connection-heading" tabIndex={-1}>
          <div className="node-connection-heading">
            <span className="node-connection-icon"><Link2 size={14} aria-hidden /></span>
            <div>
              <h4 id="node-connection-heading">Connections</h4>
              <small>{isValueConnectionSource ? 'Send this value into a compatible input.' : 'Choose what should run next.'}</small>
            </div>
          </div>
          {keyboardConnectionOptions.length > 0 ? (
            <div className="node-connection-create">
              <label>
                <span>{isValueConnectionSource ? 'Connect value to' : 'Run next'}</span>
                <select
                  value={keyboardConnectionTarget}
                  onChange={(event) => setKeyboardConnectionTarget(event.target.value)}
                >
                  <option value="">Choose a node…</option>
                  {keyboardConnectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={connectWithKeyboard} disabled={!keyboardConnectionTarget}>
                Connect
              </button>
            </div>
          ) : (
            <small className="node-hint">
              {node.data.hasOutput === false
                ? 'This node has no outgoing connection.'
                : 'All compatible nodes are already connected. Add another node to continue.'}
            </small>
          )}
          {existingConnections.length > 0 && (
            <ul className="node-connection-list" aria-label={`Connections for ${node.data.label}`}>
              {existingConnections.map((edge) => {
                const isOutgoing = edge.source === node.id;
                const otherId = isOutgoing ? edge.target : edge.source;
                const other = activeGraph?.nodes.find((candidate) => candidate.id === otherId);
                const connectionLabel = `${isOutgoing ? 'To' : 'From'} ${other?.data.label ?? 'unknown node'}`;
                return (
                  <li key={edge.id}>
                    <span>{connectionLabel}</span>
                    <button
                      type="button"
                      aria-label={`Remove connection ${connectionLabel.toLowerCase()}`}
                      title="Remove connection"
                      onClick={() => {
                        onEdgesChange([{ id: edge.id, type: 'remove' }]);
                        setConnectionMessage(`Removed connection ${connectionLabel.toLowerCase()}.`);
                      }}
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <span className="sr-only" role="status" aria-live="polite">{connectionMessage}</span>
        </section>

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
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  // Stable list — only used for instance counts / pickers, must not re-render the graph during Play.
  const sceneObjects = useStableActiveObjects();
  const selectedObject = sceneObjects.find((object) => object.id === selectedObjectId);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const createBlueprint = useEditorStore((state) => state.createBlueprint);
  const createObjectWithProps = useEditorStore((state) => state.createObjectWithProps);
  const openObjectScript = useEditorStore((state) => state.openObjectScript);
  const attachBehaviorPreset = useEditorStore((state) => state.attachBehaviorPreset);
  const attachScript = useEditorStore((state) => state.attachScript);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const onConnect = useEditorStore((state) => state.onConnect);
  const onReconnect = useEditorStore((state) => state.onReconnect);
  const addGraphNodeToBlueprint = useEditorStore((state) => state.addGraphNodeToBlueprint);
  const connectGraphNodes = useEditorStore((state) => state.connectGraphNodes);
  const variables = useEditorStore((state) => state.variables);
  const createVariable = useEditorStore((state) => state.createVariable);
  const deleteGraphNodes = useEditorStore((state) => state.deleteGraphNodes);
  const pasteGraphNodes = useEditorStore((state) => state.pasteGraphNodes);
  const autoLayoutActiveGraph = useEditorStore((state) => state.autoLayoutActiveGraph);
  const updateBlueprintFeatherSource = useEditorStore((state) => state.updateBlueprintFeatherSource);
  const syncBlueprintFeatherSource = useEditorStore((state) => state.syncBlueprintFeatherSource);
  const projectDir = useProjectStore((state) => state.projectDir);
  const externalStatus = useFeatherExternalStore((state) => state.statuses[activeBlueprintId]);
  const externalConflict = useFeatherExternalStore((state) => state.conflicts[activeBlueprintId]);
  const linkExternalSource = useFeatherExternalStore((state) => state.linkBlueprint);
  const unlinkExternalSource = useFeatherExternalStore((state) => state.unlinkBlueprint);
  const revealExternalSource = useFeatherExternalStore((state) => state.revealBlueprintFile);
  const recreateExternalSource = useFeatherExternalStore((state) => state.recreateBlueprintFile);
  const syncExternalSource = useFeatherExternalStore((state) => state.syncBlueprintNow);
  const resolveExternalConflict = useFeatherExternalStore((state) => state.resolveConflict);
  const selectedGraphNode = useEditorStore((state) => state.selectedGraphNode());
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const instanceCount = sceneObjects.filter((object) => object.script?.blueprintId === activeBlueprintId).length;
  const selectedNodeDetail = selectedGraphNode?.data.label ?? 'Blueprint Graph';
  const [editorMode, setEditorMode] = useState<'blueprint' | 'script'>(() =>
    activeBlueprint?.featherSource !== undefined ? 'script' : 'blueprint',
  );
  const [scriptCopied, setScriptCopied] = useState(false);
  const [scriptSyncMessage, setScriptSyncMessage] = useState<{ kind: 'success' | 'error' | 'pending'; text: string } | null>(null);
  const [compileResult, setCompileResult] = useState<{ source: string; diagnostics: FeatherDiagnostic[] } | null>(null);
  const [featherSelection, setFeatherSelection] = useState({ start: 0, end: 0 });
  const [featherCompletionIndex, setFeatherCompletionIndex] = useState(0);
  const [dismissedCompletionSource, setDismissedCompletionSource] = useState<string | null>(null);
  const [allowEditorTabExit, setAllowEditorTabExit] = useState(false);
  const [compactVisualPane, setCompactVisualPane] = useState<'nodes' | 'canvas' | 'details'>('canvas');
  const [compactCodePane, setCompactCodePane] = useState<'reference' | 'editor'>('editor');
  const [isFocusMode, setIsFocusMode] = useState(() => isWorkspacePanelMaximized('scripting'));
  const externalEditingAvailable = Boolean(projectDir && projectDir !== 'web');
  const collaborationParticipants = useCollaborationStore((state) => state.participants);
  const setPresenceSurface = useCollaborationStore((state) => state.setPresenceSurface);
  const blueprintCollaborators = useMemo(
    () => collaboratorsInBlueprint(collaborationParticipants, activeBlueprintId),
    [activeBlueprintId, collaborationParticipants],
  );

  useEffect(() => {
    setPresenceSurface(editorMode === 'script' ? 'script' : 'graph');
  }, [editorMode, setPresenceSurface]);

  const { fitView, screenToFlowPosition } = useReactFlow();
  const flowShellRef = useRef<HTMLDivElement | null>(null);
  const featherEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const frameGraph = useCallback(
    () => void fitView({ padding: 0.18, minZoom: 0.58, maxZoom: 1, duration: 280 }),
    [fitView],
  );
  const frameGraphAfterLayout = useCallback(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(frameGraph));
  }, [frameGraph]);
  const arrangeAndFrameGraph = useCallback(() => {
    autoLayoutActiveGraph();
    frameGraphAfterLayout();
  }, [autoLayoutActiveGraph, frameGraphAfterLayout]);
  const toggleFocusMode = useCallback(() => {
    const maximized = toggleWorkspacePanelMaximized('scripting');
    setIsFocusMode(maximized);
    frameGraphAfterLayout();
  }, [frameGraphAfterLayout]);
  const focusVisualCanvas = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => flowShellRef.current?.focus()));
  };
  // When the search menu was opened by dragging a wire into empty space, `pending` holds the socket the
  // drag started from, so picking a node auto-wires it (Unreal-style). null = opened via right-click.
  const [searchMenu, setSearchMenu] = useState<{
    x: number;
    y: number;
    pending?: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' };
  } | null>(null);
  const openNodeSearchAtCanvasCenter = useCallback(() => {
    const bounds = flowShellRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setSearchMenu({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
  }, []);
  useEffect(() => {
    if (editorMode === 'script') setSearchMenu(null);
  }, [editorMode]);
  useEffect(
    () => onWorkspacePanelMaximizedChange('scripting', setIsFocusMode),
    [],
  );
  useEffect(() => {
    if (editorMode !== 'blueprint' || compactVisualPane !== 'canvas') return;
    // Dockview and the container query settle over a couple of frames when Scripting is opened,
    // focused, or restored. Fit after that resize so cards never begin clipped under the HUD.
    const timeout = window.setTimeout(frameGraph, 220);
    return () => window.clearTimeout(timeout);
  }, [activeBlueprintId, compactVisualPane, editorMode, frameGraph, isFocusMode]);
  useEffect(() => {
    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === activeBlueprintId);
    setEditorMode(blueprint?.featherSource !== undefined ? 'script' : 'blueprint');
    setCompileResult(null);
  }, [activeBlueprintId]);

  const unlinkCurrentExternalSource = async () => {
    if (!activeBlueprint?.featherSourcePath) return;
    const confirmed = await confirmAction({
      title: 'Unlink external script?',
      message: `Feather will stop watching ${activeBlueprint.featherSourcePath}. The file stays on disk.`,
      confirmLabel: 'Unlink file',
      cancelLabel: 'Keep linked',
    });
    if (confirmed) await unlinkExternalSource(activeBlueprint.id);
  };
  // Set on connect-start, cleared by a successful onConnect; if still set at connect-end the drag landed
  // on empty canvas, which is our cue to open the node menu with that source connection pending.
  const connectingRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(
    null,
  );
  // Drives a class on the canvas while a wire is being dragged, so CSS can dim the incompatible ports
  // (exec can't connect to value): you instantly see where the wire can actually land.
  const [connectingKind, setConnectingKind] = useState<'exec' | 'value' | null>(null);
  const [connectingValueType, setConnectingValueType] = useState<GraphValueType | 'any' | null>(null);
  // Multi-node clipboard: the copied nodes plus the wires running between them (other wires don't travel).
  const [clipboard, setClipboard] = useState<{ nodes: NodeForgeNode[]; edges: Edge[] } | null>(null);

  // Palette quick-filter: type to narrow the node list by name, description, or category.
  const [paletteFilter, setPaletteFilter] = useState('');
  const featherScript = useMemo(
    () =>
      editorMode === 'script' && graph && activeBlueprint
        ? graphToFeatherScript({
            blueprint: activeBlueprint,
            graph,
            variables,
            blueprints,
          })
        : '',
    [activeBlueprint, blueprints, editorMode, graph, variables],
  );
  const featherSource = activeBlueprint?.featherSource ?? featherScript;
  const featherParse = useMemo(() => parseFeatherScript(featherSource), [featherSource]);
  const featherDiagnostics = compileResult?.source === featherSource ? compileResult.diagnostics : featherParse.diagnostics;
  const featherParseErrorCount = featherParse.diagnostics.filter((item) => item.severity === 'error').length;
  const featherErrorCount = featherDiagnostics.filter((item) => item.severity === 'error').length;
  const featherWarningCount = featherDiagnostics.filter((item) => item.severity === 'warning').length;
  const featherDiagnosticSummary = featherErrorCount
    ? `${featherErrorCount} ${featherErrorCount === 1 ? 'error' : 'errors'}. ${featherDiagnostics.find((item) => item.severity === 'error')?.message ?? ''}`
    : featherWarningCount
      ? `${featherWarningCount} ${featherWarningCount === 1 ? 'warning' : 'warnings'}. ${featherDiagnostics[0]?.message ?? ''}`
      : 'No FeatherScript errors or warnings.';
  const availableFeatherCompletions = useMemo(
    () =>
      featherSelection.start === featherSelection.end
        ? getFeatherCompletions(featherSource, featherSelection.start, {
            blueprintVariables: activeBlueprint?.variables ?? [],
            projectVariables: variables,
            limit: 6,
          })
        : [],
    [activeBlueprint?.variables, featherSelection.end, featherSelection.start, featherSource, variables],
  );
  const featherCompletions =
    dismissedCompletionSource === featherSource ? [] : availableFeatherCompletions;
  const activeFeatherCompletion = featherCompletions[Math.min(featherCompletionIndex, featherCompletions.length - 1)];
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

  useEffect(() => {
    if (!scriptCopied) return;
    const timeout = window.setTimeout(() => setScriptCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [scriptCopied]);

  const copyFeatherScript = async () => {
    if (!featherSource || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(featherSource);
      setScriptCopied(true);
    } catch {
      setScriptCopied(false);
    }
  };

  const downloadFeatherScript = () => {
    if (!activeBlueprint || !featherSource) return;
    const blob = new Blob([featherSource], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = featherFileName(activeBlueprint.name);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const updateFeatherSource = (source: string) => {
    setScriptSyncMessage({ kind: 'pending', text: 'Checking changes…' });
    setAllowEditorTabExit(false);
    updateBlueprintFeatherSource(activeBlueprintId, source);
  };

  const syncFeatherSelection = (target: HTMLTextAreaElement) => {
    setFeatherSelection({ start: target.selectionStart, end: target.selectionEnd });
  };

  const insertFeatherText = (text: string) => {
    const editor = featherEditorRef.current;
    const start = editor?.selectionStart ?? featherSelection.start;
    const end = editor?.selectionEnd ?? featherSelection.end;
    const next = `${featherSource.slice(0, start)}${text}${featherSource.slice(end)}`;
    const nextCaret = start + text.length;
    setCompactCodePane('editor');
    updateFeatherSource(next);
    window.requestAnimationFrame(() => {
      featherEditorRef.current?.focus();
      if (!featherEditorRef.current) return;
      featherEditorRef.current.selectionStart = nextCaret;
      featherEditorRef.current.selectionEnd = nextCaret;
      setFeatherSelection({ start: nextCaret, end: nextCaret });
    });
  };

  const insertFeatherSnippet = (entry: FeatherApiEntry) => insertFeatherText(entry.insertText);

  const insertStarterVariable = () => {
    const firstLineEnd = featherSource.indexOf('\n');
    const insertionPoint = firstLineEnd >= 0 ? firstLineEnd + 1 : featherSource.length;
    const declaration = '\nvar value: number = 0\n';
    const next = `${featherSource.slice(0, insertionPoint)}${declaration}${featherSource.slice(insertionPoint)}`;
    setCompactCodePane('editor');
    updateFeatherSource(next);
    const caret = insertionPoint + declaration.length;
    window.requestAnimationFrame(() => {
      featherEditorRef.current?.focus();
      if (!featherEditorRef.current) return;
      featherEditorRef.current.selectionStart = caret;
      featherEditorRef.current.selectionEnd = caret;
      setFeatherSelection({ start: caret, end: caret });
    });
  };

  const acceptFeatherCompletion = (completion: FeatherCompletion | undefined) => {
    if (!completion) return;
    const next = `${featherSource.slice(0, completion.replacementStart)}${completion.insertText}${featherSource.slice(completion.replacementEnd)}`;
    const nextCaret = completion.replacementStart + completion.caretOffset;
    setCompactCodePane('editor');
    updateFeatherSource(next);
    setFeatherCompletionIndex(0);
    window.requestAnimationFrame(() => {
      featherEditorRef.current?.focus();
      if (!featherEditorRef.current) return;
      featherEditorRef.current.selectionStart = nextCaret;
      featherEditorRef.current.selectionEnd = nextCaret;
      setFeatherSelection({ start: nextCaret, end: nextCaret });
    });
  };

  const onFeatherEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (featherCompletions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFeatherCompletionIndex((index) => (index + 1) % featherCompletions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFeatherCompletionIndex((index) => (index - 1 + featherCompletions.length) % featherCompletions.length);
        return;
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        acceptFeatherCompletion(activeFeatherCompletion);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedCompletionSource(featherSource);
        setFeatherCompletionIndex(0);
        return;
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setAllowEditorTabExit(true);
      setScriptSyncMessage({ kind: 'pending', text: 'Tab will leave the editor' });
      return;
    }

    if (event.key === 'Enter' && activeBlueprint) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const lineStart = featherSource.lastIndexOf('\n', start - 1) + 1;
      const currentLine = featherSource.slice(lineStart, start);
      const indentation = currentLine.match(/^\s*/)?.[0] ?? '';
      const blockIndent = currentLine.trimEnd().endsWith(':') ? '    ' : '';
      const insertion = `\n${indentation}${blockIndent}`;
      const next = `${featherSource.slice(0, start)}${insertion}${featherSource.slice(end)}`;
      const nextCaret = start + insertion.length;
      updateFeatherSource(next);
      window.requestAnimationFrame(() => {
        target.selectionStart = nextCaret;
        target.selectionEnd = nextCaret;
        setFeatherSelection({ start: nextCaret, end: nextCaret });
      });
      return;
    }

    if (event.key !== 'Tab' || !activeBlueprint || event.shiftKey) return;
    if (allowEditorTabExit) {
      setAllowEditorTabExit(false);
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const indent = '    ';
    const next = `${featherSource.slice(0, start)}${indent}${featherSource.slice(start)}`;
    updateFeatherSource(next);
    window.requestAnimationFrame(() => {
      target.selectionStart = start + indent.length;
      target.selectionEnd = end + indent.length;
    });
  };

  useEffect(() => {
    setFeatherCompletionIndex(0);
  }, [featherSelection.start, featherSource]);

  useEffect(() => {
    if (editorMode !== 'script') return;
    if (!activeBlueprint || activeBlueprint.featherSource === undefined) {
      setScriptSyncMessage(null);
      setCompileResult(null);
      return;
    }
    if (featherParseErrorCount > 0) {
      setCompileResult({ source: featherSource, diagnostics: featherParse.diagnostics });
      setScriptSyncMessage({ kind: 'error', text: 'Fix errors to update Visual' });
      return;
    }

    setScriptSyncMessage({ kind: 'pending', text: 'Checking changes…' });
    const timeout = window.setTimeout(() => {
      const state = useEditorStore.getState();
      const blueprint = state.blueprints.find((item) => item.id === activeBlueprint.id);
      const liveGraph = state.graphs.find((item) => item.id === blueprint?.graphId);
      if (!blueprint || !liveGraph) return;
      const preview = compileFeatherScriptToGraph({
        source: featherSource,
        blueprint,
        graph: liveGraph,
        variables: state.variables,
        blueprints: state.blueprints,
        preserveSource: true,
      });
      setCompileResult({ source: featherSource, diagnostics: preview.diagnostics });
      const errors = preview.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
      const warnings = preview.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
      const blockingWarnings = preview.diagnostics.filter(isBlockingFeatherWarning).length;
      if (!preview.ok || errors || blockingWarnings) {
        const count = errors || blockingWarnings;
        const label = errors ? 'error' : 'warning';
        setScriptSyncMessage({
          kind: 'error',
          text: `Fix ${count} ${label}${count === 1 ? '' : 's'} to update Visual`,
        });
        return;
      }
      syncBlueprintFeatherSource(activeBlueprint.id, featherSource);
      setScriptSyncMessage({
        kind: 'success',
        text: warnings ? `Visual updated · ${warnings} suggestion${warnings === 1 ? '' : 's'}` : 'Visual is up to date',
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    activeBlueprint?.id,
    activeBlueprint?.featherSource,
    editorMode,
    featherParse.diagnostics,
    featherParseErrorCount,
    featherSource,
    syncBlueprintFeatherSource,
  ]);

  // Exec-flow visualization (Unreal-style): while Play runs with this editor open, the runtime marks
  // every exec node it runs (see runtime/execTrace); we poll that trace and pulse the nodes + wires
  // that executed within the last ~⅓ second.
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const [hotNodes, setHotNodes] = useState<Set<string>>(() => new Set());
  // Live value readouts (formatted) per node, polled from the value trace at the same cadence.
  const [liveValues, setLiveValues] = useState<Record<string, string>>({});
  // Executions per node within the last poll window (only entries > 1 are kept for badges).
  const [hitCounts, setHitCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setExecTraceEnabled(isPlaying);
    setValueTraceEnabled(isPlaying);
    if (!isPlaying) {
      setHotNodes((prev) => (prev.size ? new Set<string>() : prev));
      setLiveValues((prev) => (Object.keys(prev).length ? {} : prev));
      setHitCounts((prev) => (Object.keys(prev).length ? {} : prev));
      return () => {
        setExecTraceEnabled(false);
        setValueTraceEnabled(false);
      };
    }
    const interval = window.setInterval(() => {
      const cutoff = performance.now() - 350;
      const next = new Set<string>();
      for (const [nodeId, at] of execTrace.nodes) if (at >= cutoff) next.add(nodeId);
      setHotNodes((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
      const counts: Record<string, number> = {};
      for (const [nodeId, count] of execTrace.counts) {
        if (count > 1 && next.has(nodeId)) counts[nodeId] = count;
      }
      resetExecWindowCounts();
      setHitCounts((prev) => {
        const keys = Object.keys(counts);
        if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === counts[k])) return prev;
        return counts;
      });
      // Snapshot current value readouts; bail out of the state update when nothing changed.
      const values: Record<string, string> = {};
      for (const [nodeId, value] of valueTrace.values) values[nodeId] = formatTraceValue(value);
      setLiveValues((prev) => {
        const keys = Object.keys(values);
        if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === values[k])) return prev;
        return values;
      });
    }, 150);
    return () => {
      window.clearInterval(interval);
      setExecTraceEnabled(false);
      setValueTraceEnabled(false);
    };
  }, [isPlaying]);

  // The node a breakpoint stopped Play on, so it can be marked distinctly from a normal pulse.
  const brokeHere = useEditorStore((state) => state.runtimeBreakNodeId);
  const flowNodeCacheRef = useRef(
    new WeakMap<NodeForgeNode, { decorationKey: string; node: NodeForgeNode }>(),
  );

  // Nodes fed to React Flow, tagged with the exec-hot pulse class while executing and carrying a
  // transient `liveValue` / `execHitCount` (read by NodeForgeGraphNode). Reuse decorated objects for
  // untouched nodes so dragging one card does not ask every card in a large graph to re-render.
  const flowNodes = useMemo<NodeForgeNode[]>(() => {
    const nodes = graph?.nodes;
    if (!nodes) return [];
    const hasValues = Object.keys(liveValues).length > 0;
    const hasHits = Object.keys(hitCounts).length > 0;
    return nodes.map((node) => {
      const live = liveValues[node.id];
      const hits = hitCounts[node.id];
      const hot = hotNodes.has(node.id);
      const className = hot
        ? brokeHere === node.id
          ? 'exec-hot exec-broke'
          : 'exec-hot'
        : brokeHere === node.id
          ? 'exec-broke'
          : '';
      const decorationKey = `${className}|${live ?? ''}|${hits ?? ''}|${node.selected ? 1 : 0}`;
      const cached = flowNodeCacheRef.current.get(node);
      if (cached?.decorationKey === decorationKey) return cached.node;
      const decorated: NodeForgeNode = {
        ...node,
        ariaLabel: `${node.data.label}, ${node.data.category} node${node.selected ? ', selected' : ''}`,
        ...(className ? { className } : {}),
        ...((hasValues || hasHits) && (live || hits)
          ? {
              data: {
                ...node.data,
                ...(live ? { liveValue: live } : {}),
                ...(hits ? { execHitCount: hits } : {}),
              },
            }
          : {}),
      };
      flowNodeCacheRef.current.set(node, { decorationKey, node: decorated });
      return decorated;
    });
  }, [graph, hotNodes, liveValues, hitCounts, brokeHere]);

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

  // When the menu was opened by dragging a pin into empty space, narrow choices to nodes that can
  // actually accept (or provide) that wire — Unreal-style context add.
  const searchMenuChoices = useMemo(() => {
    const pending = searchMenu?.pending;
    if (!pending || !graph) return nodeChoices;
    const origin = graph.nodes.find((node) => node.id === pending.nodeId);
    if (!origin) return nodeChoices;
    const exec = (pending.handleId ?? '').startsWith('exec');
    if (pending.handleType === 'source') {
      if (exec) {
        // Dragging from an exec-out → need nodes with an exec-in (actions / gates, not pure values).
        return nodeChoices.filter(
          (choice) =>
            choice.action === 'create-variable' ||
            choice.label === 'New Variable' ||
            (choice.nodeKind ? !valueProducerKinds.has(choice.nodeKind) : choice.valueType === 'exec'),
        );
      }
      const sourceType = outputTypeForHandle(
        origin.data.nodeKind,
        pending.handleId,
        origin.data.valueType as GraphValueType | undefined,
      );
      return nodeChoices.filter((choice) => {
        if (choice.action === 'create-variable' || choice.label === 'New Variable') return true;
        if (!choice.nodeKind) return false;
        const pins = valueInputsFor(choice.nodeKind);
        if (pins.length === 0) return false;
        return pins.some((pin) =>
          valueTypesCompatible(
            sourceType,
            inputTypeForHandle(choice.nodeKind!, pin.id, choice.data?.valueType as GraphValueType | undefined),
          ),
        );
      });
    }
    // Dragging from a target pin → need a provider (exec-out or value-out).
    if (exec) {
      return nodeChoices.filter(
        (choice) =>
          choice.action === 'create-variable' ||
          choice.label === 'New Variable' ||
          (choice.nodeKind ? !valueProducerKinds.has(choice.nodeKind) : choice.valueType === 'exec'),
      );
    }
    const targetType = inputTypeForHandle(
      origin.data.nodeKind,
      pending.handleId,
      origin.data.valueType as GraphValueType | undefined,
    );
    return nodeChoices.filter((choice) => {
      if (choice.action === 'create-variable' || choice.label === 'New Variable') return targetType === 'number' || targetType === 'any';
      if (!choice.nodeKind) return false;
      if (!valueProducerKinds.has(choice.nodeKind) && choice.nodeKind !== 'logic.cast' && choice.nodeKind !== 'action.spawnPrefab') {
        return false;
      }
      const out = choice.valueType && choice.valueType !== 'exec' ? choice.valueType : outputTypeOf[choice.nodeKind] ?? 'any';
      return valueTypesCompatible(out, targetType);
    });
  }, [graph, nodeChoices, searchMenu]);

  const searchFilterHint = useMemo(() => {
    const pending = searchMenu?.pending;
    if (!pending || !graph) return null;
    const origin = graph.nodes.find((node) => node.id === pending.nodeId);
    if (!origin) return null;
    const exec = (pending.handleId ?? '').startsWith('exec');
    if (exec) return 'exec nodes';
    if (pending.handleType === 'source') {
      const t = outputTypeForHandle(origin.data.nodeKind, pending.handleId, origin.data.valueType as GraphValueType | undefined);
      return t === 'any' ? 'value consumers' : `${t} consumers`;
    }
    const t = inputTypeForHandle(origin.data.nodeKind, pending.handleId, origin.data.valueType as GraphValueType | undefined);
    return t === 'any' ? 'value nodes' : `${t} nodes`;
  }, [graph, searchMenu]);

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
    // Auto-wire the socket that opened the menu. Value outputs choose the first compatible input on
    // the picked node, so the common "drag a number, choose Rotate" flow completes in one action.
    const pending = screen.pending;
    if (pending) {
      const liveGraph = useEditorStore.getState().activeGraph();
      const created = liveGraph?.nodes.find((node) => node.id === id);
      const kind = created?.data.nodeKind as GraphNodeKind | undefined;
      const isPureValueNode = kind ? valueProducerKinds.has(kind) : false;
      const hasValueOutput = Boolean(
        kind && (isPureValueNode || kind === 'logic.cast' || kind === 'action.spawnPrefab'),
      );
      const exec = (pending.handleId ?? '').startsWith('exec');
      let connection: Connection | null = null;
      if (pending.handleType === 'source') {
        if (exec && !isPureValueNode) {
          connection = { source: pending.nodeId, sourceHandle: pending.handleId, target: id, targetHandle: 'exec-in' };
        } else if (!exec && kind) {
          const origin = liveGraph?.nodes.find((node) => node.id === pending.nodeId);
          const sourceType = origin
            ? outputTypeForHandle(
                origin.data.nodeKind,
                pending.handleId,
                origin.data.valueType as GraphValueType | undefined,
              )
            : 'any';
          const input = valueInputsFor(kind).find((pin) =>
            valueTypesCompatible(
              sourceType,
              inputTypeForHandle(kind, pin.id, created?.data.valueType as GraphValueType | undefined),
            ),
          );
          if (input) {
            connection = { source: pending.nodeId, sourceHandle: pending.handleId, target: id, targetHandle: input.id };
          }
        }
      } else if (exec && !isPureValueNode) {
        // Dragged from an exec INPUT → drive it from the new action node's exec-out.
        connection = { source: id, sourceHandle: 'exec-out', target: pending.nodeId, targetHandle: pending.handleId };
      } else if (!exec && hasValueOutput) {
        // Dragged from a value INPUT → feed it from the new value node's value-out (the common "I need a value here").
        connection = { source: id, sourceHandle: 'value-out', target: pending.nodeId, targetHandle: pending.handleId };
      }
      if (connection) onConnect(connection);
    }
    selectGraphNode(id);
    setSearchMenu(null);
  };

  const canvasCenterPosition = () => {
    const bounds = flowShellRef.current?.getBoundingClientRect();
    if (!bounds) return undefined;
    return screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
  };

  const addPaletteNode = (label: string, category: GraphNodeCategory) => {
    const position = canvasCenterPosition();
    if (label === 'New Variable') {
      createVariableNode(position);
      return;
    }
    const id = addGraphNodeToBlueprint(activeBlueprintId, label, category, {}, position);
    selectGraphNode(id);
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
      const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (plainKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        event.stopImmediatePropagation();
        openNodeSearchAtCanvasCenter();
        return;
      }
      if (plainKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopImmediatePropagation();
        frameGraph();
        return;
      }
      if (event.ctrlKey && !event.metaKey && event.code === 'Space') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleFocusMode();
        return;
      }
      // The working set = every marquee/shift-selected node, falling back to the inspector's single selection.
      const selectedNodes = graph?.nodes.filter((node) => node.selected) ?? [];
      const selectedEdges = graph?.edges.filter((edge) => edge.selected) ?? [];
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
      if (isDelete && (selectedNodes.length || selectedEdges.length)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectedEdges.length) onEdgesChange(selectedEdges.map((edge) => ({ id: edge.id, type: 'remove' })));
        if (selectedNodes.length) deleteGraphNodes(selectedNodes.map((node) => node.id));
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    activeBlueprintId,
    clipboard,
    deleteGraphNodes,
    frameGraph,
    graph,
    onEdgesChange,
    openNodeSearchAtCanvasCenter,
    pasteGraphNodes,
    selectGraphNode,
    toggleFocusMode,
  ]);

  // Reject self-wires, exec↔value crosses, and typed value mismatches (number↛vector3, etc.).
  // `any` is a wild card so references / untyped Get Variable still connect freely.
  const isExecHandle = (handleId?: string | null) => (handleId ?? '').startsWith('exec');
  const isValidConnection = (connection: Connection | Edge) => {
    if (connection.source === connection.target) return false;
    const sourceExec = isExecHandle(connection.sourceHandle);
    const targetExec = isExecHandle(connection.targetHandle);
    if (sourceExec !== targetExec) return false;
    if (sourceExec) return true;
    if (!graph) return true;
    const sourceNode = graph.nodes.find((node) => node.id === connection.source);
    const targetNode = graph.nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return false;
    const sourceType = outputTypeForHandle(
      sourceNode.data.nodeKind,
      connection.sourceHandle,
      sourceNode.data.valueType as GraphValueType | undefined,
    );
    const targetType = inputTypeForHandle(
      targetNode.data.nodeKind,
      connection.targetHandle,
      targetNode.data.valueType as GraphValueType | undefined,
    );
    return valueTypesCompatible(sourceType, targetType);
  };

  // Drag-to-create: remember the socket a wire drag started from; clear it the moment a real connection
  // lands on another socket (onConnect fires first). If it's still set at connect-end, the wire was
  // dropped on empty canvas → open the node menu there with this socket pending so the pick auto-wires.
  const onConnectStart = (_event: unknown, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
    connectingRef.current = params.nodeId && params.handleType ? { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType } : null;
    const exec = isExecHandle(params.handleId);
    setConnectingKind(exec ? 'exec' : 'value');
    if (exec || !params.nodeId || !params.handleType) {
      setConnectingValueType(null);
      return;
    }
    const node = graph?.nodes.find((candidate) => candidate.id === params.nodeId);
    if (!node) {
      setConnectingValueType('any');
      return;
    }
    setConnectingValueType(
      params.handleType === 'source'
        ? outputTypeForHandle(
            node.data.nodeKind,
            params.handleId,
            node.data.valueType as GraphValueType | undefined,
          ) as GraphValueType | 'any'
        : inputTypeForHandle(
            node.data.nodeKind,
            params.handleId,
            node.data.valueType as GraphValueType | undefined,
          ) as GraphValueType | 'any',
    );
  };
  const handleConnect = (connection: Connection) => {
    connectingRef.current = null;
    setConnectingKind(null);
    setConnectingValueType(null);
    onConnect(connection);
  };
  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    const pending = connectingRef.current;
    connectingRef.current = null;
    setConnectingKind(null);
    setConnectingValueType(null);
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
    const labelByNode = new Map<string, string>();
    for (const node of graph.nodes) {
      typeByNode.set(node.id, outputTypeOf[node.data.nodeKind] ?? (node.data.valueType as GraphValueType | undefined) ?? 'any');
      labelByNode.set(node.id, node.data.label);
    }
    return graph.edges.map((edge) => {
      const exec = isExecHandle(edge.sourceHandle);
      // A wire pulses gold while both its endpoints executed within the trace window.
      const hot = exec && hotNodes.has(edge.source) && hotNodes.has(edge.target);
      const stroke = hot ? '#ffd34d' : exec ? EXEC_WIRE_COLOR : VALUE_TYPE_COLORS[typeByNode.get(edge.source) ?? 'any'];
      return {
        ...edge,
        animated: hot || Boolean(edge.selected),
        ariaLabel: `${exec ? 'Execution' : 'Value'} connection from ${labelByNode.get(edge.source) ?? 'unknown node'} to ${labelByNode.get(edge.target) ?? 'unknown node'}`,
        style: { ...edge.style, stroke, strokeWidth: hot || edge.selected ? 3 : 2 },
      };
    });
  }, [graph, hotNodes]);

  const compileCurrentDraft = () => {
    if (!activeBlueprint || !graph) return null;
    const result = compileFeatherScriptToGraph({
      source: featherSource,
      blueprint: activeBlueprint,
      graph,
      variables,
      blueprints,
      preserveSource: true,
    });
    setCompileResult({ source: featherSource, diagnostics: result.diagnostics });
    return result;
  };

  const switchToVisual = () => {
    if (!activeBlueprint || activeBlueprint.featherSource === undefined) {
      setEditorMode('blueprint');
      return true;
    }
    const result = compileCurrentDraft();
    const errors = result?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length ?? 1;
    const warnings = result?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length ?? 0;
    const blockingWarnings = result?.diagnostics.filter(isBlockingFeatherWarning).length ?? 0;
    if (!result?.ok || errors || blockingWarnings) {
      const count = errors || blockingWarnings;
      const label = errors ? 'error' : 'warning';
      setScriptSyncMessage({
        kind: 'error',
        text: `Fix ${count} ${label}${count === 1 ? '' : 's'} before opening Visual`,
      });
      setCompactCodePane('editor');
      window.requestAnimationFrame(() => featherEditorRef.current?.focus());
      return false;
    }
    syncBlueprintFeatherSource(activeBlueprint.id, featherSource);
    setScriptSyncMessage({
      kind: 'success',
      text: warnings ? `Visual updated · ${warnings} suggestion${warnings === 1 ? '' : 's'}` : 'Visual is up to date',
    });
    setEditorMode('blueprint');
    return true;
  };

  const jumpToDiagnostic = (diagnostic: FeatherDiagnostic) => {
    const lines = featherSource.split('\n');
    const lineIndex = Math.max(0, Math.min(lines.length - 1, diagnostic.line - 1));
    const lineStart = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0);
    const start = Math.min(featherSource.length, lineStart + Math.max(0, diagnostic.column - 1));
    const end = Math.min(featherSource.length, start + Math.max(1, diagnostic.length));
    setEditorMode('script');
    setCompactCodePane('editor');
    window.requestAnimationFrame(() => {
      const editor = featherEditorRef.current;
      if (!editor) return;
      editor.focus();
      editor.selectionStart = start;
      editor.selectionEnd = end;
      setFeatherSelection({ start, end });
    });
  };

  const applyStarterBehavior = (presetId: string) => {
    const preset = BEHAVIOR_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    const objectId = selectedObject?.id ?? createObjectWithProps('cube', { name: preset.name });
    const blueprintId = attachBehaviorPreset(objectId, preset.id);
    if (!blueprintId) return;
    setActiveBlueprint(blueprintId);
    setEditorMode('blueprint');
    focusVisualCanvas();
  };

  const startBlankBehavior = () => {
    const objectId = selectedObject?.id ?? createObjectWithProps('cube', { name: 'Scripted Cube' });
    openObjectScript(objectId);
    setEditorMode('blueprint');
    focusVisualCanvas();
  };

  const addStarterFlow = (
    eventLabel: 'Start' | 'Update',
    actionLabel: 'Print' | 'Rotate' | 'Translate',
    data: Partial<NodeForgeNodeData>,
  ) => {
    if (!graph || !activeBlueprint) return;
    const eventNode = graph.nodes.find((node) => node.data.label === eventLabel);
    const eventId =
      eventNode?.id ??
      addGraphNodeToBlueprint(
        activeBlueprint.id,
        eventLabel,
        'Events',
        eventLabel === 'Start' ? { hasInput: false } : {},
      );
    const actionId = addGraphNodeToBlueprint(activeBlueprint.id, actionLabel, 'Runtime', data);
    connectGraphNodes(activeBlueprint.id, eventId, actionId, 'exec-out', 'exec-in');
    selectGraphNode(actionId);
    window.requestAnimationFrame(() => {
      arrangeAndFrameGraph();
      flowShellRef.current?.focus();
    });
  };

  const resetCodeFromVisual = async () => {
    const confirmed = await confirmAction({
      title: 'Replace this code draft?',
      message: 'This will replace your current FeatherScript draft with code generated from the Visual graph.',
      confirmLabel: 'Use visual version',
      cancelLabel: 'Keep draft',
      danger: true,
    });
    if (confirmed) updateBlueprintFeatherSource(activeBlueprintId, undefined);
  };

  const attachActiveBehavior = async () => {
    if (!selectedObject || !activeBlueprint) return;
    if (selectedObject.script && selectedObject.script.blueprintId !== activeBlueprint.id) {
      const confirmed = await confirmAction({
        title: `Replace ${selectedObject.name}'s behavior?`,
        message: `This object will stop using its current behavior and use ${activeBlueprint.name} instead.`,
        confirmLabel: 'Replace behavior',
        cancelLabel: 'Keep current',
        danger: true,
      });
      if (!confirmed) return;
    }
    attachScript(selectedObject.id, activeBlueprint.id);
  };

  if (!graph || !activeBlueprint) {
    return (
      <section className="panel scripting-panel scripting-panel-welcome">
        <div className="scripting-welcome">
          <div className="scripting-welcome-hero">
            <span className="scripting-welcome-icon">
              <Sparkles size={22} aria-hidden />
            </span>
            <div>
              <span className="eyebrow">Scripting, made simple</span>
              <h2>Make an object do something</h2>
              <p>
                {selectedObject
                  ? `Add an editable behavior to ${selectedObject.name}, then press Play to try it.`
                  : 'Choose a ready-made behavior. Feather will create an object, wire the logic, and open it for you.'}
              </p>
            </div>
          </div>

          {selectedObject?.script ? (
            <div className="scripting-welcome-current">
              <div>
                <strong>{selectedObject.name} already has a behavior</strong>
                <span>Open it to edit the visual flow or FeatherScript code.</span>
              </div>
              <button type="button" className="primary-button" onClick={() => openObjectScript(selectedObject.id)}>
                Open behavior
                <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="starter-behavior-section">
              <div className="starter-section-heading">
                <div>
                  <strong>Start with a recipe</strong>
                  <span>You can change every node and value afterward.</span>
                </div>
                <small>{selectedObject ? `Adding to ${selectedObject.name}` : 'Creates a cube automatically'}</small>
              </div>
              <div className="starter-behavior-grid">
                {starterBehaviors.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="starter-behavior-card"
                    onClick={() => applyStarterBehavior(preset.id)}
                  >
                    <span className="starter-behavior-icon" aria-hidden>{preset.icon}</span>
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </span>
                    <ArrowRight size={14} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="scripting-welcome-footer">
            {!selectedObject?.script && (
              <button type="button" className="secondary-button" onClick={startBlankBehavior}>
                <Plus size={14} aria-hidden />
                Start blank
              </button>
            )}
            {blueprints.length > 0 && (
              <label className="welcome-blueprint-picker">
                <span>Or open an existing behavior</span>
                <select defaultValue="" onChange={(event) => event.target.value && setActiveBlueprint(event.target.value)}>
                  <option value="" disabled>Choose behavior…</option>
                  {blueprints.map((blueprint) => (
                    <option key={blueprint.id} value={blueprint.id}>{blueprint.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="text-button" onClick={createBlueprint}>
              Create a reusable behavior only
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel scripting-panel" aria-labelledby="scripting-behavior-title">
      <div className="scripting-header-stack">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Reusable behavior</span>
          <h2 id="scripting-behavior-title">{activeBlueprint.name}</h2>
          <div
            className="scripting-mode-toggle"
            role="tablist"
            aria-label="Scripting mode"
            onKeyDown={(event) =>
              handleTabListKeyDown(event, ['blueprint', 'script'], editorMode, (value) =>
                value === 'blueprint' ? switchToVisual() : void setEditorMode('script'),
              )
            }
          >
            <button
              id="visual-scripting-tab"
              className={editorMode === 'blueprint' ? 'active' : ''}
              type="button"
              role="tab"
              data-tab-value="blueprint"
              tabIndex={editorMode === 'blueprint' ? 0 : -1}
              aria-selected={editorMode === 'blueprint'}
              aria-controls="visual-scripting-workspace"
              onClick={switchToVisual}
            >
              <Waypoints size={13} aria-hidden />
              <span>Visual</span>
            </button>
            <button
              id="code-scripting-tab"
              className={editorMode === 'script' ? 'active' : ''}
              type="button"
              role="tab"
              data-tab-value="script"
              tabIndex={editorMode === 'script' ? 0 : -1}
              aria-selected={editorMode === 'script'}
              aria-controls="code-scripting-workspace"
              onClick={() => setEditorMode('script')}
            >
              <Code2 size={13} aria-hidden />
              <span>Code</span>
            </button>
          </div>
        </div>
        <div className="panel-actions graph-actions">
          <CollaboratorAvatars
            participants={blueprintCollaborators}
            label={`also ${blueprintCollaborators.length === 1 ? 'has' : 'have'} ${activeBlueprint.name} open`}
          />
          <span
            className={`blueprint-instances${instanceCount === 0 ? ' is-unattached' : ''}`}
            title={`${instanceCount} scene ${instanceCount === 1 ? 'object uses' : 'objects use'} this behavior`}
            aria-label={`${instanceCount} scene ${instanceCount === 1 ? 'instance' : 'instances'}`}
          >
            <Boxes size={14} aria-hidden />
            {instanceCount} {instanceCount === 1 ? 'instance' : 'instances'}
          </span>
          <select
            className="blueprint-select"
            value={activeBlueprintId}
            onChange={(event) => setActiveBlueprint(event.target.value)}
            title="Select Blueprint asset"
            aria-label="Select reusable behavior"
          >
            {blueprints.map((blueprint) => (
              <option key={blueprint.id} value={blueprint.id}>
                {blueprint.name}
              </option>
            ))}
          </select>
          {editorMode === 'blueprint' && (
            <button
              className="icon-button compact"
              title="Auto-arrange and frame nodes"
              aria-label="Auto-arrange and frame nodes"
              onClick={arrangeAndFrameGraph}
            >
              <LayoutGrid size={14} aria-hidden />
            </button>
          )}
          <button
            className="icon-button compact graph-focus-toggle"
            type="button"
            title={isFocusMode ? 'Restore workspace (Ctrl+Space)' : 'Focus Scripting (Ctrl+Space)'}
            aria-label={isFocusMode ? 'Restore workspace' : 'Focus Scripting'}
            aria-pressed={isFocusMode}
            onClick={toggleFocusMode}
          >
            {isFocusMode ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
          </button>
          <button className="icon-button compact" title="Create reusable Blueprint" aria-label="Create reusable behavior" onClick={createBlueprint}>
            <Plus size={14} aria-hidden />
          </button>
        </div>
      </div>

      {instanceCount === 0 && (
        <div className="blueprint-usage-banner" role="status">
          <span className="blueprint-usage-icon"><Link2 size={15} aria-hidden /></span>
          <div>
            <strong>This behavior is not attached yet</strong>
            <span>It will not run during Play until a scene object uses it.</span>
          </div>
          {selectedObject && selectedObject.script?.blueprintId !== activeBlueprint.id && (
            <button type="button" onClick={() => void attachActiveBehavior()}>
              Use on {selectedObject.name}
            </button>
          )}
        </div>
      )}
      </div>

      {editorMode === 'blueprint' && externalConflict && (
        <div className="feather-external-status conflict feather-visual-conflict-notice" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span>
            <strong>External script conflict</strong>
            <small>Sync is paused until you choose which version to keep.</small>
          </span>
          <button type="button" onClick={() => setEditorMode('script')}>
            Review in Code
          </button>
        </div>
      )}

      {editorMode !== 'script' && (
        <div id="code-scripting-workspace" role="tabpanel" aria-labelledby="code-scripting-tab" hidden />
      )}
      {editorMode !== 'blueprint' && (
        <div id="visual-scripting-workspace" role="tabpanel" aria-labelledby="visual-scripting-tab" hidden />
      )}

      {editorMode === 'script' ? (
        <div
          className="feather-script-body"
          id="code-scripting-workspace"
          role="tabpanel"
          aria-labelledby="code-scripting-tab"
          data-compact-pane={compactCodePane}
        >
          <div className="scripting-compact-nav" role="group" aria-label="Code workspace view">
            <button
              type="button"
              aria-pressed={compactCodePane === 'reference'}
              className={compactCodePane === 'reference' ? 'active' : ''}
              onClick={() => setCompactCodePane('reference')}
            >
              Reference
            </button>
            <button
              type="button"
              aria-pressed={compactCodePane === 'editor'}
              className={compactCodePane === 'editor' ? 'active' : ''}
              onClick={() => setCompactCodePane('editor')}
            >
              Code editor
            </button>
          </div>
          <aside className="node-palette feather-script-sidebar">
            <div className="blueprint-card graph-overview-card">
              <div>
                <strong>{activeBlueprint.name}</strong>
                <span>{activeBlueprint.description}</span>
              </div>
              <div className="graph-overview-stats">
                <span>{graph.nodes.length} nodes</span>
                <span>{(activeBlueprint.variables ?? []).length} vars</span>
              </div>
            </div>
            <section className="feather-symbols">
              <h3>
                <Code2 size={13} aria-hidden />
                <span>Symbols</span>
                <small>{(activeBlueprint.variables ?? []).length}</small>
              </h3>
              <div>
                {(activeBlueprint.variables ?? []).map((variable) => (
                  <button
                    key={variable.id}
                    type="button"
                    className="feather-symbol"
                    title={`Insert self.${variable.name.replace(/\s+/g, '_')}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertFeatherText(`self.${variable.name.replace(/\s+/g, '_')}`)}
                  >
                    <strong>{variable.name}</strong>
                    <small>{variable.type}</small>
                  </button>
                ))}
                {(activeBlueprint.variables ?? []).length === 0 && (
                  <button
                    type="button"
                    className="feather-symbol empty"
                    onClick={insertStarterVariable}
                  >
                    <Plus size={13} aria-hidden />
                    <span>Create your first variable</span>
                  </button>
                )}
              </div>
            </section>
            <section className="feather-api">
              <h3>
                <Code2 size={13} aria-hidden />
                <span>API</span>
                <small>{FEATHER_SIDEBAR_API.length}</small>
              </h3>
              <div>
                {FEATHER_SIDEBAR_API.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="feather-api-entry"
                    title={entry.description}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertFeatherSnippet(entry)}
                  >
                    <strong>{entry.signature}</strong>
                    <small>{entry.description}</small>
                  </button>
                ))}
              </div>
            </section>
            <section className="feather-diagnostics" aria-labelledby="feather-diagnostics-title">
              <h3 id="feather-diagnostics-title">
                <AlertTriangle size={13} aria-hidden />
                <span>Diagnostics</span>
                <small>{featherDiagnostics.length}</small>
              </h3>
              <div>
                {featherDiagnostics.length === 0 ? (
                  <span className="feather-diagnostic empty">No issues</span>
                ) : (
                  featherDiagnostics.map((diagnostic, index) => (
                    <button
                      key={`${diagnostic.line}:${diagnostic.column}:${diagnostic.message}:${index}`}
                      type="button"
                      className={`feather-diagnostic ${diagnostic.severity}`}
                      onClick={() => jumpToDiagnostic(diagnostic)}
                      title="Jump to this issue"
                    >
                      <strong>
                        {diagnostic.line}:{diagnostic.column}
                      </strong>
                      <span>{diagnostic.message}</span>
                    </button>
                  ))
                )}
              </div>
            </section>
          </aside>

          <div className="feather-script-shell">
            <div className="feather-script-toolbar">
              <div className="feather-script-title">
                <Code2 size={15} aria-hidden />
                <span>{featherFileName(activeBlueprint.name)}</span>
              </div>
              <div className="panel-actions">
                <span
                  className={`feather-status${featherErrorCount ? ' has-errors' : featherWarningCount ? ' has-warnings' : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  {featherErrorCount || featherWarningCount
                    ? <AlertTriangle size={13} aria-hidden />
                    : <CheckCircle2 size={13} aria-hidden />}
                  <span>
                    {featherErrorCount
                      ? `${featherErrorCount} error${featherErrorCount === 1 ? '' : 's'}`
                      : featherWarningCount
                        ? `${featherWarningCount} warning${featherWarningCount === 1 ? '' : 's'}`
                        : 'Ready'}
                  </span>
                </span>
                {scriptSyncMessage && (
                  <span
                    className={`feather-sync-message ${scriptSyncMessage.kind}`}
                    role={scriptSyncMessage.kind === 'pending' ? undefined : 'status'}
                    aria-live={scriptSyncMessage.kind === 'pending' ? 'off' : 'polite'}
                  >
                    {scriptSyncMessage.text}
                  </span>
                )}
                {activeBlueprint.featherSourcePath ? (
                  <>
                    <button
                      className="icon-button compact"
                      title={`Reveal linked script: ${activeBlueprint.featherSourcePath}`}
                      aria-label="Reveal linked FeatherScript file"
                      onClick={() => void revealExternalSource(activeBlueprint.id)}
                    >
                      <FolderOpen size={14} aria-hidden />
                    </button>
                    <button
                      className="icon-button compact"
                      title="Unlink external FeatherScript file"
                      aria-label="Unlink external FeatherScript file"
                      onClick={() => void unlinkCurrentExternalSource()}
                    >
                      <Unlink size={14} aria-hidden />
                    </button>
                  </>
                ) : (
                  <button
                    className="icon-button compact"
                    title={
                      externalEditingAvailable
                        ? 'Create a linked .feather file for VS Code or another editor'
                        : 'Save this project in the desktop app to link an external editor'
                    }
                    aria-label="Link FeatherScript to an external editor"
                    onClick={() => void linkExternalSource(activeBlueprint.id)}
                    disabled={!externalEditingAvailable}
                  >
                    <Link2 size={14} aria-hidden />
                  </button>
                )}
                <button
                  className="icon-button compact"
                  title={scriptCopied ? 'Copied' : 'Copy FeatherScript'}
                  aria-label={scriptCopied ? 'FeatherScript copied' : 'Copy FeatherScript'}
                  onClick={() => void copyFeatherScript()}
                  disabled={!featherSource}
                >
                  <Copy size={14} aria-hidden />
                </button>
                <button
                  className="icon-button compact"
                  title="Replace draft with code from Visual"
                  aria-label="Replace code draft with the Visual version"
                  onClick={() => void resetCodeFromVisual()}
                  disabled={activeBlueprint.featherSource === undefined}
                >
                  <RotateCcw size={14} aria-hidden />
                </button>
                <button
                  className="icon-button compact"
                  title="Download FeatherScript"
                  aria-label="Download FeatherScript"
                  onClick={downloadFeatherScript}
                  disabled={!featherSource}
                >
                  <Download size={14} aria-hidden />
                </button>
              </div>
            </div>
            <div className="feather-editor-guide" id="feather-editor-help">
              <Sparkles size={14} aria-hidden />
              <span>Edits update Visual automatically.</span>
              <small>Type <code>on</code> or <code>self.</code> for suggestions · Tab accepts · Esc, then Tab leaves the editor</small>
            </div>
            <div className="feather-external-notices">
              {activeBlueprint.featherSourcePath && externalStatus && (
                <div
                  className={`feather-external-status ${externalStatus.kind}`}
                  role={externalStatus.kind === 'conflict' || externalStatus.kind === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {externalStatus.kind === 'synced' ? (
                    <CheckCircle2 size={14} aria-hidden />
                  ) : externalStatus.kind === 'syncing' ? (
                    <RotateCcw size={14} aria-hidden />
                  ) : (
                    <AlertTriangle size={14} aria-hidden />
                  )}
                  <span>
                    <strong>{activeBlueprint.featherSourcePath}</strong>
                    <small>{externalStatus.message}</small>
                  </span>
                  {externalStatus.kind === 'missing' && (
                    <button type="button" onClick={() => void recreateExternalSource(activeBlueprint.id)}>
                      Recreate file
                    </button>
                  )}
                  {externalStatus.kind === 'error' && (
                    <button type="button" onClick={() => void syncExternalSource(activeBlueprint.id)}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              {externalConflict && (
                <section className="feather-external-conflict" role="alert" aria-label="External script conflict">
                  <div className="feather-external-conflict__summary">
                    <AlertTriangle size={16} aria-hidden />
                    <span>
                      <strong>Feather and the external file differ</strong>
                      <small>Review both versions, then choose which one should become current.</small>
                    </span>
                    <div className="feather-external-conflict__actions">
                      <button
                        type="button"
                        onClick={() => void resolveExternalConflict(activeBlueprint.id, 'external')}
                        disabled={externalStatus?.kind === 'syncing'}
                      >
                        Use external file
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void resolveExternalConflict(activeBlueprint.id, 'internal')}
                        disabled={externalStatus?.kind === 'syncing'}
                      >
                        Keep Feather version
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolveExternalConflict(activeBlueprint.id, 'visual')}
                        disabled={externalStatus?.kind === 'syncing'}
                      >
                        Use Visual graph
                      </button>
                    </div>
                  </div>
                  <details>
                    <summary>Compare versions</summary>
                    <div className="feather-external-compare">
                      <div>
                        <strong>Feather</strong>
                        <pre>{externalConflict.internalSource}</pre>
                      </div>
                      <div>
                        <strong>External file</strong>
                        <pre>{externalConflict.diskSource}</pre>
                      </div>
                      <div>
                        <strong>Visual graph</strong>
                        <pre>{externalConflict.visualSource}</pre>
                      </div>
                    </div>
                  </details>
                </section>
              )}
            </div>
            <div className="feather-editor-stage">
              <span
                className="sr-only"
                id="feather-editor-diagnostics"
                role={featherErrorCount ? 'alert' : 'status'}
                aria-live="polite"
              >
                {featherDiagnosticSummary}
              </span>
              <textarea
                ref={featherEditorRef}
                className="feather-code feather-code-editor"
                value={featherSource}
                onChange={(event) => {
                  syncFeatherSelection(event.currentTarget);
                  updateFeatherSource(event.target.value);
                }}
                onClick={(event) => syncFeatherSelection(event.currentTarget)}
                onKeyDown={onFeatherEditorKeyDown}
                onKeyUp={(event) => syncFeatherSelection(event.currentTarget)}
                onSelect={(event) => syncFeatherSelection(event.currentTarget)}
                spellCheck={false}
                aria-invalid={featherErrorCount > 0}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-describedby="feather-editor-help feather-editor-diagnostics"
                aria-errormessage={featherErrorCount ? 'feather-editor-diagnostics' : undefined}
                aria-controls={featherCompletions.length ? 'feather-completion-list' : undefined}
                aria-expanded={featherCompletions.length > 0}
                aria-activedescendant={featherCompletions.length ? `feather-completion-${featherCompletionIndex}` : undefined}
                aria-label="FeatherScript source"
              />
              {featherCompletions.length > 0 && (
                <div
                  className="feather-completions"
                  id="feather-completion-list"
                  role="listbox"
                  aria-label="FeatherScript completions"
                >
                  {featherCompletions.map((completion, index) => (
                    <button
                      key={`${completion.id}:${completion.insertText}`}
                      id={`feather-completion-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === featherCompletionIndex}
                      className={index === featherCompletionIndex ? 'active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => acceptFeatherCompletion(completion)}
                    >
                      <strong>{completion.signature}</strong>
                      <small>{completion.description}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="scripting-body"
          id="visual-scripting-workspace"
          role="tabpanel"
          aria-labelledby="visual-scripting-tab"
          data-compact-pane={compactVisualPane}
        >
          <div className="scripting-compact-nav" role="group" aria-label="Visual scripting workspace view">
            <button
              type="button"
              aria-pressed={compactVisualPane === 'nodes'}
              className={compactVisualPane === 'nodes' ? 'active' : ''}
              onClick={() => setCompactVisualPane('nodes')}
            >
              Add nodes
            </button>
            <button
              type="button"
              aria-pressed={compactVisualPane === 'canvas'}
              className={compactVisualPane === 'canvas' ? 'active' : ''}
              onClick={() => setCompactVisualPane('canvas')}
            >
              Canvas
            </button>
            <button
              type="button"
              aria-pressed={compactVisualPane === 'details'}
              className={compactVisualPane === 'details' ? 'active' : ''}
              onClick={() => setCompactVisualPane('details')}
            >
              Details
            </button>
          </div>
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
                placeholder="Search actions, events, values…"
                aria-label="Search scripting nodes"
                spellCheck={false}
              />
            </label>
          {!paletteFilter.trim() && (
            <section className="essential-node-group">
              <h3>
                <Sparkles size={13} aria-hidden />
                <span>Essentials</span>
                <small>{essentialNodes.length}</small>
              </h3>
              <div className="essential-node-grid">
                {essentialNodes.map(({ label, category }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => addPaletteNode(label, category)}
                    title={nodeDescriptions[label]}
                  >
                    <span className="node-palette-icon"><Plus size={12} aria-hidden /></span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {filteredNodeGroups.length === 0 && (
            <div className="empty-state compact">No nodes match “{paletteFilter}”</div>
          )}
          {filteredNodeGroups.map(({ title, icon: Icon, nodes }) => (
            <PaletteGroup
              key={title}
              title={title}
              icon={Icon}
              count={nodes.length}
              forceOpen={paletteFilter.trim() !== ''}
              defaultOpen={title === 'Events'}
            >
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
          className={[
            'flow-shell',
            connectingKind ? `connecting-from-${connectingKind}` : '',
            connectingValueType ? `connecting-type-${connectingValueType}` : '',
          ].filter(Boolean).join(' ')}
          ref={flowShellRef}
          tabIndex={0}
          role="region"
          aria-label="Visual scripting canvas"
          aria-describedby="visual-scripting-help"
          // Capture-phase: runs before ReactFlow's own pointer handlers, so node
          // selection works reliably even inside the docked panel. ReactFlow tags
          // each node wrapper with data-id.
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).classList.contains('react-flow__pane')) flowShellRef.current?.focus();
          }}
          onClickCapture={(event) => {
            const nodeEl = (event.target as HTMLElement).closest('.react-flow__node');
            const id = nodeEl?.getAttribute('data-id');
            if (id) selectGraphNode(id);
          }}
          onContextMenuCapture={(event) => {
            if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return;
            event.preventDefault();
            setSearchMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setSearchMenu({ x: bounds.left + bounds.width / 2, y: bounds.top + Math.min(180, bounds.height / 2) });
          }}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          <p className="sr-only" id="visual-scripting-help">
            Press A to add a node, F to frame the graph, or Control Space to focus the Scripting panel. Tab to a node, then press Enter or Space to select it and use arrow keys to move it. Drag a pin into empty space to choose and automatically connect a compatible node. Use the Connections section in Details to create or remove wires. Press Delete to remove a selected node or wire.
          </p>
          {/* The add-node button shares this HUD row rather than floating separately — both used to
              sit at top-left of .flow-shell and overlapped. aria-hidden moved onto the text children
              so the button itself stays reachable. */}
          <div className="flow-hud">
            <button
              type="button"
              className="flow-add-node"
              title="Add a node — or describe what you want and press Enter"
              onClick={(event) => {
                const bounds = event.currentTarget.closest('.flow-shell')!.getBoundingClientRect();
                setSearchMenu({ x: bounds.left + 24, y: bounds.top + 56 });
              }}
            >
              <Plus size={14} aria-hidden />
              <span>Add node</span>
            </button>
            <button
              type="button"
              className="flow-canvas-action flow-frame-button"
              title="Frame all nodes (F)"
              aria-label="Frame all nodes"
              onClick={frameGraph}
            >
              <Focus size={14} aria-hidden />
            </button>
            <span aria-hidden>{selectedNodeDetail}</span>
            <small aria-hidden>
              {graph.nodes.length} nodes / {graph.edges.length} wires
              {clipboard ? ` / ${clipboard.nodes.length} copied` : ''} · Drag a pin to empty space (or
              right-click) to add a node · A add · F frame · Shift+drag box-select
            </small>
          </div>
          {graph.edges.length === 0 && graph.nodes.length <= 2 && (
            <div className="starter-flow-coach" role="region" aria-label="Quick start">
              <div className="starter-flow-copy">
                <span className="starter-flow-icon"><Sparkles size={16} aria-hidden /></span>
                <div>
                  <strong>What should happen first?</strong>
                  <small>Choose one working flow. You can edit its values and add more nodes next.</small>
                </div>
              </div>
              <div className="starter-flow-actions">
                <button
                  type="button"
                  onClick={() => addStarterFlow('Start', 'Print', { message: 'Hello from Feather!' })}
                >
                  <strong>Say hello</strong>
                  <small>Start → Print</small>
                </button>
                <button
                  type="button"
                  onClick={() => addStarterFlow('Update', 'Rotate', { axis: 'y', amount: 90 })}
                >
                  <strong>Spin</strong>
                  <small>Update → Rotate</small>
                </button>
                <button
                  type="button"
                  onClick={() => addStarterFlow('Update', 'Translate', { axis: 'z', amount: 2 })}
                >
                  <strong>Move forward</strong>
                  <small>Update → Translate</small>
                </button>
              </div>
            </div>
          )}
          <ReactFlow
            aria-label="Visual script diagram"
            nodes={flowNodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            edgesFocusable
            edgesReconnectable
            onNodeClick={(_, node) => selectGraphNode(node.id)}
            onEdgeDoubleClick={(event, edge) => {
              event.stopPropagation();
              onEdgesChange([{ id: edge.id, type: 'remove' }]);
            }}
            onSelectionChange={({ nodes, edges }) => {
              // Only ADOPT an actual selection here — never clear on an empty event. Editing a node's
              // fields in the inspector replaces the nodes array, and because we don't persist React Flow's
              // `selected` flag, React Flow momentarily reports an empty selection; clearing on that would
              // deselect the node and close the inspector mid-edit. Real deselection is handled by onPaneClick.
              const id = nodes[0]?.id;
              if (id && id !== selectedGraphNode?.id) selectGraphNode(id);
              if (edges.length > 0) selectGraphNode(undefined);
            }}
            onPaneClick={() => {
              selectGraphNode(undefined);
              setSearchMenu(null);
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionLineStyle={connectionLineStyle}
            connectionRadius={28}
            reconnectRadius={28}
            autoPanSpeed={18}
            onlyRenderVisibleElements
            snapToGrid
            snapGrid={snapGrid}
            fitView
            fitViewOptions={{ padding: 0.18, minZoom: 0.58, maxZoom: 1, duration: 240 }}
          >
            {/* xyflow's MiniMap defaults to a LIGHT mask (rgba(240,240,240,.6)) and light node
                fills, which rendered as a big white slab covering the bottom of the canvas on a dark
                theme. These are SVG paint attributes, so CSS on .react-flow__minimap can't reach
                them — they have to be passed as props. */}
            <MiniMap
              ariaLabel="Visual script overview"
              pannable
              zoomable
              nodeStrokeWidth={3}
              bgColor="#12161d"
              maskColor="rgba(8, 11, 16, 0.62)"
              maskStrokeColor="rgba(150, 180, 220, 0.28)"
              nodeColor="#4d9dff"
              nodeStrokeColor="rgba(140, 175, 220, 0.35)"
            />
            <Controls aria-label="Visual script zoom controls" position="bottom-right" />
            <Background color="#30394D" gap={24} size={1} />
          </ReactFlow>
        </div>
        <NodeInspector node={selectedGraphNode} />
      </div>
      )}

      {searchMenu && (
        <NodeSearchMenu
          x={searchMenu.x}
          y={searchMenu.y}
          choices={searchMenuChoices}
          filterHint={searchFilterHint}
          onPick={(choice) => addNodeAt(choice, searchMenu)}
          onClose={() => setSearchMenu(null)}
          onAskAI={(prompt) =>
            window.dispatchEvent(
              new CustomEvent('nf:ask-ai', {
                detail: {
                  // Name the target blueprint so the assistant doesn't have to guess which graph,
                  // and insist on preserving what's there — set_blueprint_script replaces the whole
                  // script, so a vaguer prompt risks wiping the user's existing nodes.
                  prompt:
                    `In the blueprint "${activeBlueprint.name}", add this behavior: ${prompt}\n\n` +
                    `Keep every existing node and wire the new logic into the current graph. ` +
                    `Read the current script first, then write back the full script including what was already there.`,
                },
              }),
            )
          }
        />
      )}
    </section>
  );
}
