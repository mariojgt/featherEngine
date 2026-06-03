import { useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useReactFlow, type NodeTypes } from '@xyflow/react';
import { Boxes, Database, GitBranch, LayoutDashboard, LayoutGrid, MousePointer2, Plus, Save, Send, Sigma, Table2, Trash2, Waypoints, Zap } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { NodeForgeGraphNode } from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import type { GraphNodeCategory, GraphValue, GraphValueType, NodeForgeNode, UIElement, Vector3Tuple } from '../types';

const nodeTypes: NodeTypes = {
  nodeforge: NodeForgeGraphNode,
};

export const nodeGroups: Array<{
  title: GraphNodeCategory;
  icon: typeof Zap;
  nodes: string[];
}> = [
  {
    title: 'Events',
    icon: Zap,
    nodes: ['Start', 'Update', 'Key Down', 'Key Up', 'Custom Event', 'Collision Enter', 'Trigger Enter', 'Trigger Exit', 'Interact'],
  },
  {
    title: 'Logic',
    icon: GitBranch,
    nodes: ['Branch', 'Compare', 'AND', 'OR', 'Cast', 'Cooldown', 'For Loop'],
  },
  {
    title: 'Math',
    icon: Sigma,
    nodes: ['Add', 'Clamp', 'Lerp'],
  },
  {
    title: 'Values',
    icon: Database,
    nodes: ['Number', 'Random', 'String', 'Boolean', 'Vector3'],
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
    nodes: ['Translate', 'Rotate', 'Get Move Input', 'Move', 'Jump', 'Get Drive Input', 'Drive', 'Get Vehicle Speed', 'Is Grounded', 'Set Camera', 'Set Ragdoll', 'Spawn Projectile', 'Spawn Attached', 'Set Visible', 'Burst Particles', 'Set Particles Emitting', 'Spawn Particle System', 'Fire Event', 'Play Cinematic', 'Spawn Object', 'Load Scene', 'Destroy Object', 'Play Sound', 'Set Material Color', 'Set Material Property', 'Get Material Color', 'Get Material Property', 'Set Anim Float', 'Set Anim Bool', 'Set Anim Trigger', 'Play Animation', 'Set Movement Mode', 'Get Anim Param', 'Get Anim State', 'Distance To Player', 'Direction To Player', 'Player Location', 'Face Player', 'Print'],
  },
  {
    title: 'Physics',
    icon: Boxes,
    nodes: ['Apply Force'],
  },
  {
    title: 'Persistence',
    icon: Save,
    nodes: ['Save Game', 'Load Game', 'Clear Save'],
  },
  {
    title: 'UI',
    icon: LayoutDashboard,
    nodes: ['Show UI', 'Hide UI', 'Set UI Text'],
  },
];

export const baseNodeChoices: NodeChoice[] = nodeGroups.flatMap((group) =>
  group.nodes.map((label) => ({ label, category: group.title })),
);

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

const spawnKinds: Array<['cube' | 'sphere' | 'capsule' | 'plane', string]> = [
  ['cube', 'Cube'],
  ['sphere', 'Sphere'],
  ['capsule', 'Capsule'],
  ['plane', 'Plane'],
];

const valueTypes: GraphValueType[] = ['number', 'string', 'boolean', 'vector3'];
const compareOps = ['==', '!=', '>', '>=', '<', '<='] as const;

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
            <Plus size={13} aria-hidden />
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
                <Trash2 size={13} aria-hidden />
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
            <Plus size={13} aria-hidden />
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
                  <Trash2 size={13} aria-hidden />
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
            <Plus size={13} aria-hidden />
          </button>
        </div>

        {dataAssets.map((table) => (
          <div className="library-card data-table-card" key={table.id}>
            <div className="library-row">
              <input value={table.name} onChange={(event) => renameDataAsset(table.id, event.target.value)} />
              <button title="Delete Data Asset" onClick={() => deleteDataAsset(table.id)}>
                <Trash2 size={13} aria-hidden />
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
  const activeScene = useEditorStore((state) => state.scenes.find((scene) => scene.id === state.activeSceneId));
  const scenes = useEditorStore((state) => state.scenes);
  const sceneObjects = useEditorStore(selectActiveObjects);
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
  const updatesAxis =
    node.data.nodeKind === 'action.translate' ||
    node.data.nodeKind === 'action.rotate' ||
    node.data.nodeKind === 'action.applyForce';
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
    node.data.nodeKind === 'action.setParticlesEmitting';
  const updatesNumberValue =
    node.data.nodeKind === 'value.number' ||
    node.data.nodeKind === 'math.add' ||
    node.data.nodeKind === 'math.clamp' ||
    node.data.nodeKind === 'math.lerp' ||
    node.data.nodeKind === 'logic.compare' ||
    node.data.nodeKind === 'animator.setFloat' ||
    node.data.nodeKind === 'action.burstParticles';
  const updatesParamName =
    node.data.nodeKind === 'animator.setFloat' ||
    node.data.nodeKind === 'animator.setBool' ||
    node.data.nodeKind === 'animator.setTrigger' ||
    node.data.nodeKind === 'animator.getParam';
  const updatesStringValue = node.data.nodeKind === 'value.string';
  const updatesVectorValue = node.data.nodeKind === 'value.vector3' || node.data.nodeKind === 'action.spawnParticleSystem';
  const updatesSaveSlot = node.data.nodeKind === 'save.write' || node.data.nodeKind === 'save.load' || node.data.nodeKind === 'save.clear';
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
  const updatesCast = node.data.nodeKind === 'logic.cast';
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
  const wiredCastBlueprintId = wiredSource?.data.nodeKind === 'logic.cast' ? wiredSource.data.castBlueprintId : undefined;
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
  const updatesOtherObject = node.data.nodeKind === 'event.collisionEnter' || node.data.nodeKind === 'event.triggerEnter';
  const updatesTargetObject =
    node.data.nodeKind === 'action.destroyObject' ||
    node.data.nodeKind === 'action.setRagdoll' ||
    node.data.nodeKind === 'action.burstParticles' ||
    node.data.nodeKind === 'action.setParticlesEmitting' ||
    node.data.nodeKind === 'action.spawnParticleSystem';
  const selectedUIDoc = uiDocuments.find((doc) => doc.id === node.data.documentId);
  const eventName = node.data.eventName || 'CustomEvent';
  const selectedVariable = variables.find((variable) => variable.id === node.data.variableId);
  const selectedTable = dataAssets.find((table) => table.id === node.data.tableId);
  const selectedColumn =
    selectedTable?.columns.find((column) => column.id === node.data.columnId) ?? selectedTable?.columns[0];

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
                value={node.data.variableId ?? ''}
                onChange={(event) => updateGraphNodeData(node.id, { variableId: event.target.value || undefined })}
              >
                <option value="">{variables.length ? 'Select variable' : 'Create a variable below'}</option>
                {variables.map((variable) => (
                  <option key={variable.id} value={variable.id}>
                    {variable.name} · {variable.type}
                  </option>
                ))}
              </select>
            </label>
            {node.data.nodeKind === 'variable.set' && selectedVariable && (
              <label className="node-field">
                <span>Fallback value</span>
                <ValueEditor
                  type={selectedVariable.type}
                  value={graphValueFromNode(node, selectedVariable.type)}
                  onChange={(value) => updateGraphNodeData(node.id, graphValuePatch(selectedVariable.type, value))}
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
                    : 'Units / sec'}
              </span>
              <input
                type="number"
                step="0.1"
                value={node.data.amount ?? (node.data.nodeKind === 'action.rotate' ? 90 : node.data.nodeKind === 'action.applyForce' ? 8 : -3.6)}
                onChange={(event) => updateGraphNodeData(node.id, { amount: Number(event.target.value) })}
              />
            </label>
          </>
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
  const sceneObjects = useEditorStore(selectActiveObjects);
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
  const autoLayoutActiveGraph = useEditorStore((state) => state.autoLayoutActiveGraph);
  const selectedGraphNode = useEditorStore((state) => state.selectedGraphNode());
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const instanceCount = sceneObjects.filter((object) => object.script?.blueprintId === activeBlueprintId).length;

  const { screenToFlowPosition } = useReactFlow();
  const [searchMenu, setSearchMenu] = useState<{ x: number; y: number } | null>(null);

  const nodeChoices = useMemo<NodeChoice[]>(
    () => [
      ...baseNodeChoices,
      ...variables.flatMap((variable) => [
        {
          label: `Get ${variable.name}`,
          category: 'Variables' as GraphNodeCategory,
          nodeLabel: 'Get Variable',
          data: { variableId: variable.id, valueType: variable.type },
        },
        {
          label: `Set ${variable.name}`,
          category: 'Variables' as GraphNodeCategory,
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

  const addNodeAt = (choice: NodeChoice, screen: { x: number; y: number }) => {
    const position = screenToFlowPosition({ x: screen.x, y: screen.y });
    if (choice.action === 'create-variable' || choice.label === 'New Variable') {
      createVariableNode(position);
      setSearchMenu(null);
      return;
    }
    const id = addGraphNodeToBlueprint(activeBlueprintId, choice.nodeLabel ?? choice.label, choice.category, choice.data ?? {}, position);
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
                  <button key={node} onClick={() => addPaletteNode(node, title)} title={`Add ${node}`}>
                    <Plus size={13} aria-hidden />
                    <span>{node}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <div
          className="flow-shell"
          // Capture-phase: runs before ReactFlow's own pointer handlers, so node
          // selection works reliably even inside the docked panel. ReactFlow tags
          // each node wrapper with data-id.
          onClickCapture={(event) => {
            const nodeEl = (event.target as HTMLElement).closest('.react-flow__node');
            const id = nodeEl?.getAttribute('data-id');
            if (id) selectGraphNode(id);
          }}
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
