import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';
import {
  Ampersand,
  AlertTriangle,
  ArrowLeftRight,
  Axis3d,
  Ban,
  Box,
  CircleDot,
  Crosshair,
  Database,
  Dices,
  Divide,
  Equal,
  Eye,
  Gauge,
  GitBranch,
  GitMerge,
  Hash,
  Image,
  Keyboard,
  Minus,
  Move3d,
  Percent,
  Ruler,
  Scaling,
  ShieldAlert,
  Swords,
  Layers,
  LayoutDashboard,
  Move,
  Repeat,
  Play,
  Plus,
  Power,
  Radar,
  Radio,
  RefreshCw,
  RotateCw,
  Save,
  ScanLine,
  Scissors,
  Search,
  Send,
  Sigma,
  SquareFunction,
  Palette,
  Spline,
  Sparkles,
  SlidersHorizontal,
  Terminal,
  Timer,
  ToggleLeft,
  Trash2,
  Type as TextIcon,
  Vibrate,
  Volume2,
  Waypoints,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import type { GraphNodeKind, GraphNodeTone, GraphValueType, NodeForgeNode } from '../types';
import { keyLabelByCode } from '../utils/keyboardCodes';

/** Wire/handle colors per data type. 'any' = type not statically known (e.g. variable.get). */
export const VALUE_TYPE_COLORS: Record<GraphValueType | 'any', string> = {
  number: '#5bd1ff',
  boolean: '#ff6b6b',
  string: '#f78fb3',
  vector3: '#f7b955',
  any: '#9aa6c0',
};
export const EXEC_WIRE_COLOR = '#d6deef';

/** Static output type of a value-producing node, used to color its value-out port and outgoing wires. */
export const outputTypeOf: Partial<Record<GraphNodeKind, GraphValueType>> = {
  'value.number': 'number',
  'value.random': 'number',
  'math.add': 'number',
  'math.subtract': 'number',
  'math.multiply': 'number',
  'math.divide': 'number',
  'math.modulo': 'number',
  'math.clamp': 'number',
  'math.lerp': 'number',
  'math.distance': 'number',
  'animator.getParam': 'number',
  'query.vehicleSpeed': 'number',
  'event.receiveDamage': 'number',
  'value.string': 'string',
  'animator.getState': 'string',
  'value.boolean': 'boolean',
  'logic.compare': 'boolean',
  'logic.and': 'boolean',
  'logic.or': 'boolean',
  'logic.not': 'boolean',
  'query.grounded': 'boolean',
  'save.has': 'boolean',
  'query.raycast': 'boolean',
  'query.overlapSphere': 'boolean',
  'query.cableTension': 'number',
  'math.abs': 'number',
  'math.min': 'number',
  'math.max': 'number',
  'math.round': 'number',
  'math.power': 'number',
  'math.sin': 'number',
  'math.cos': 'number',
  'string.append': 'string',
  'value.vector3': 'vector3',
  'ai.playerLocation': 'vector3',
  'input.move': 'vector3',
  'input.driveInput': 'vector3',
  'math.vectorAdd': 'vector3',
  'math.vectorSubtract': 'vector3',
  'math.vectorScale': 'vector3',
  'math.normalize': 'vector3',
  'math.makeVector': 'vector3',
  'action.getPosition': 'vector3',
  'action.getRotation': 'vector3',
  'action.getScale': 'vector3',
  'query.velocity': 'vector3',
};

const valueTypeLabels: Record<GraphValueType | 'any', string> = {
  number: 'Number',
  boolean: 'Bool',
  string: 'String',
  vector3: 'Vec3',
  any: 'Value',
};

const toneIcon: Record<GraphNodeTone, typeof Zap> = {
  event: Zap,
  logic: GitBranch,
  math: Sigma,
  runtime: Waypoints,
  physics: Box,
  audio: Volume2,
  value: Radio,
  variable: Database,
  data: Database,
  persistence: Save,
  material: Palette,
  ui: LayoutDashboard,
};

const kindIcon: Partial<Record<GraphNodeKind, typeof Zap>> = {
  'event.start': Play,
  'event.update': RefreshCw,
  'event.keyDown': Keyboard,
  'event.keyUp': Keyboard,
  'event.custom': Radio,
  'event.collisionEnter': Crosshair,
  'event.collisionExit': Crosshair,
  'event.triggerEnter': Crosshair,
  'event.receiveDamage': ShieldAlert,
  'event.timer': Timer,
  'logic.branch': GitBranch,
  'logic.compare': Equal,
  'logic.and': Ampersand,
  'logic.or': GitMerge,
  'logic.forLoop': Repeat,
  'logic.forEachActor': Repeat,
  'logic.not': Ban,
  'logic.doOnce': CircleDot,
  'logic.delay': Timer,
  'math.add': Plus,
  'math.subtract': Minus,
  'math.multiply': X,
  'math.divide': Divide,
  'math.modulo': Percent,
  'math.clamp': ArrowLeftRight,
  'math.lerp': Spline,
  'math.distance': Ruler,
  'math.vectorAdd': Plus,
  'math.vectorSubtract': Minus,
  'math.vectorScale': Scaling,
  'math.normalize': Move3d,
  'math.makeVector': Axis3d,
  'action.getPosition': Crosshair,
  'action.getRotation': RotateCw,
  'action.getScale': Scaling,
  'query.findActorByBlueprint': Search,
  'query.findActorByTag': Search,
  'query.raycast': ScanLine,
  'query.overlapSphere': Radar,
  'action.cutCable': Scissors,
  'action.setCableLength': Ruler,
  'query.cableTension': Gauge,
  'action.setPosition': Move,
  'action.setRotation': RotateCw,
  'action.setScale': Scaling,
  'action.tweenProperty': Spline,
  'event.functionEntry': SquareFunction,
  'logic.callFunction': SquareFunction,
  'action.lookAt': Eye,
  'value.number': Hash,
  'value.random': Dices,
  'value.string': TextIcon,
  'value.boolean': ToggleLeft,
  'value.vector3': Axis3d,
  'variable.get': Database,
  'variable.set': Database,
  'data.tableGet': Database,
  'action.translate': Move,
  'action.rotate': RotateCw,
  'action.applyForce': Wind,
  'action.applyImpulse': Zap,
  'action.applyTorque': RotateCw,
  'action.setPhysics': Box,
  'action.setVelocity': Gauge,
  'action.setEnvironment': Palette,
  'query.velocity': Gauge,
  'action.fireEvent': Send,
  'action.spawnObject': Sparkles,
  'action.cameraShake': Vibrate,
  'action.applyDamage': Swords,
  'action.setQuality': Gauge,
  'action.moveTo': Waypoints,
  'action.loadScene': Layers,
  'action.destroyObject': Trash2,
  'action.playSound': Volume2,
  'action.setMaterialColor': Palette,
  'action.setMaterialProperty': SlidersHorizontal,
  'animator.setFloat': Hash,
  'animator.setBool': ToggleLeft,
  'animator.setTrigger': Zap,
  'animator.getParam': Hash,
  'animator.getState': Radio,
  'input.move': Keyboard,
  'input.driveInput': Keyboard,
  'query.grounded': Crosshair,
  'action.move': Move,
  'action.drive': Move,
  'action.jump': Wind,
  'action.setCamera': Crosshair,
  'action.spawnProjectile': Send,
  'action.setVisible': Sparkles,
  'action.setActive': Power,
  'ai.distanceToPlayer': Crosshair,
  'ai.directionToPlayer': Move,
  'ai.playerLocation': Crosshair,
  'action.facePlayer': RotateCw,
  'logic.cooldown': RefreshCw,
  'material.output': SlidersHorizontal,
  'material.color': Palette,
  'material.scalar': Hash,
  'material.texture': Image,
  'material.mix': GitMerge,
  'material.multiply': Plus,
  'material.add': Plus,
  'material.clamp': ArrowLeftRight,
  'action.getMaterialColor': Palette,
  'action.getMaterialProperty': SlidersHorizontal,
  'save.write': Save,
  'save.load': Database,
  'save.clear': Trash2,
  'save.has': Database,
  'action.setTimeScale': Timer,
  'action.print': Terminal,
  'ui.show': LayoutDashboard,
  'ui.hide': LayoutDashboard,
  'ui.setText': TextIcon,
  'variable.getObject': Database,
  'variable.setObject': Database,
};

const valueProducerKinds = new Set<GraphNodeKind>([
  'logic.compare',
  'logic.and',
  'logic.or',
  'logic.not',
  'logic.select',
  'math.abs',
  'math.min',
  'math.max',
  'math.round',
  'math.power',
  'math.sin',
  'math.cos',
  'string.append',
  'math.add',
  'math.subtract',
  'math.multiply',
  'math.divide',
  'math.modulo',
  'math.clamp',
  'math.lerp',
  'math.distance',
  'math.vectorAdd',
  'math.vectorSubtract',
  'math.vectorScale',
  'math.normalize',
  'math.makeVector',
  'action.getPosition',
  'action.getRotation',
  'action.getScale',
  'query.findActorByBlueprint',
  'query.findActorByTag',
  'query.raycast',
  'query.velocity',
  'value.number',
  'value.random',
  'value.string',
  'value.boolean',
  'value.vector3',
  'variable.get',
  'variable.getObject',
  'data.tableGet',
  'material.color',
  'material.scalar',
  'material.texture',
  'material.mix',
  'material.multiply',
  'material.add',
  'material.clamp',
  'action.getMaterialColor',
  'action.getMaterialProperty',
  'input.move',
  'input.driveInput',
  'query.vehicleSpeed',
  'query.grounded',
  'save.has',
  'animator.getParam',
  'animator.getState',
  'ai.playerLocation',
]);

const valueInputsFor = (kind: GraphNodeKind): Array<{ id: string; label: string }> => {
  switch (kind) {
    case 'logic.branch':
      return [{ id: 'condition', label: 'Condition' }];
    case 'logic.compare':
    case 'logic.and':
    case 'logic.or':
    case 'math.add':
    case 'math.subtract':
    case 'math.multiply':
    case 'math.divide':
    case 'math.modulo':
    case 'math.distance':
    case 'math.vectorAdd':
    case 'math.vectorSubtract':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
    case 'logic.not':
    case 'math.normalize':
    case 'math.abs':
    case 'math.round':
    case 'math.sin':
    case 'math.cos':
      return [{ id: 'value', label: 'Value' }];
    case 'math.min':
    case 'math.max':
    case 'math.power':
    case 'string.append':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
    case 'logic.select':
      return [
        { id: 'condition', label: 'Condition' },
        { id: 'a', label: 'A (true)' },
        { id: 'b', label: 'B (false)' },
      ];
    case 'logic.switch':
      return [{ id: 'value', label: 'Value' }];
    case 'logic.functionReturn':
      return [{ id: 'value', label: 'Value' }];
    case 'logic.callFunction':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ];
    case 'action.spawnPrefab':
      return [{ id: 'location', label: 'Location' }];
    case 'logic.delay':
      return [{ id: 'seconds', label: 'Seconds' }];
    case 'math.vectorScale':
      return [
        { id: 'vector', label: 'Vector' },
        { id: 'scale', label: 'Scale' },
      ];
    case 'math.makeVector':
      return [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
        { id: 'z', label: 'Z' },
      ];
    case 'action.setPosition':
      return [
        { id: 'position', label: 'Position' },
        { id: 'target', label: 'Target' },
      ];
    case 'action.setRotation':
      return [
        { id: 'rotation', label: 'Rotation' },
        { id: 'target', label: 'Target' },
      ];
    case 'action.setScale':
      return [
        { id: 'scale', label: 'Scale' },
        { id: 'target', label: 'Target' },
      ];
    case 'action.lookAt':
      return [
        { id: 'point', label: 'Point' },
        { id: 'target', label: 'Target' },
      ];
    case 'action.tweenProperty':
      return [
        { id: 'to', label: 'To' },
        { id: 'duration', label: 'Duration' },
        { id: 'target', label: 'Target' },
      ];
    case 'math.clamp':
      return [
        { id: 'value', label: 'Value' },
        { id: 'min', label: 'Min' },
        { id: 'max', label: 'Max' },
      ];
    case 'math.lerp':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 't', label: 'T' },
      ];
    case 'variable.set':
      return [{ id: 'value', label: 'Value' }];
    case 'variable.setObject':
      return [
        { id: 'value', label: 'Value' },
        { id: 'target', label: 'Target' },
      ];
    case 'variable.getObject':
    case 'action.getPosition':
    case 'action.getRotation':
    case 'action.getScale':
      return [{ id: 'target', label: 'Target' }];
    case 'query.raycast':
      return [
        { id: 'direction', label: 'Direction' },
        { id: 'distance', label: 'Distance' },
      ];
    case 'query.overlapSphere':
      return [
        { id: 'location', label: 'Location' },
        { id: 'radius', label: 'Radius' },
      ];
    case 'action.setCableLength':
      return [{ id: 'length', label: 'Length' }];
    case 'logic.cast':
      return [{ id: 'object', label: 'Object' }];
    case 'logic.forLoop':
      return [{ id: 'count', label: 'Count' }];
    case 'value.random':
      return [
        { id: 'min', label: 'Min' },
        { id: 'max', label: 'Max' },
      ];
    case 'ui.setText':
      return [{ id: 'text', label: 'Text' }];
    case 'data.tableGet':
      return [{ id: 'rowKey', label: 'Row Key' }];
    case 'action.translate':
      return [
        { id: 'vector', label: 'Vector' },
        { id: 'amount', label: 'Amount' },
      ];
    case 'action.rotate':
      return [{ id: 'amount', label: 'Amount' }];
    case 'action.applyForce':
    case 'action.applyImpulse':
      return [
        { id: 'vector', label: 'Force' },
        { id: 'amount', label: 'Amount' },
      ];
    case 'action.setPhysics':
      return [
        { id: 'target', label: 'Target' },
        { id: 'enabled', label: 'Enabled' },
        { id: 'mass', label: 'Mass' },
        { id: 'gravityScale', label: 'Gravity' },
        { id: 'friction', label: 'Friction' },
        { id: 'restitution', label: 'Bounce' },
      ];
    case 'action.setVelocity':
      return [{ id: 'vector', label: 'Velocity' }];
    case 'query.velocity':
      return [{ id: 'target', label: 'Target' }];
    case 'action.print':
      return [{ id: 'message', label: 'Message' }];
    case 'action.fireEvent':
      return [
        { id: 'target', label: 'Target' },
        { id: 'payload', label: 'Payload' },
      ];
    case 'animator.setFloat':
    case 'animator.setBool':
      return [{ id: 'value', label: 'Value' }];
    case 'action.move':
      return [
        { id: 'vector', label: 'Direction' },
        { id: 'speed', label: 'Speed' },
      ];
    case 'action.drive':
      return [{ id: 'vector', label: 'Drive Input' }];
    case 'action.setCamera':
      return [
        { id: 'distance', label: 'Distance' },
        { id: 'height', label: 'Height' },
      ];
    case 'action.setRagdoll':
      return [{ id: 'on', label: 'On' }];
    case 'action.setVisible':
      return [{ id: 'visible', label: 'Visible' }];
    case 'action.setActive':
      return [{ id: 'on', label: 'On' }];
    case 'action.burstParticles':
      return [{ id: 'count', label: 'Count' }];
    case 'action.setParticlesEmitting':
      return [{ id: 'on', label: 'On' }];
    case 'action.spawnParticleSystem':
      return [{ id: 'location', label: 'Location' }];
    case 'action.spawnProjectile':
      return [
        { id: 'speed', label: 'Speed' },
        { id: 'damage', label: 'Damage' },
        { id: 'spread', label: 'Spread' },
      ];
    case 'action.cameraShake':
      return [{ id: 'amount', label: 'Amount' }];
    case 'action.setTimeScale':
      return [{ id: 'scale', label: 'Scale' }];
    case 'action.applyTorque':
      return [
        { id: 'target', label: 'Target' },
        { id: 'vector', label: 'Torque' },
        { id: 'amount', label: 'Amount' },
      ];
    case 'action.applyDamage':
      return [
        { id: 'target', label: 'Target' },
        { id: 'amount', label: 'Amount' },
      ];
    case 'action.moveTo':
      return [
        { id: 'target', label: 'Target' },
        { id: 'speed', label: 'Speed' },
      ];
    case 'material.output':
      return [
        { id: 'baseColor', label: 'Base Color' },
        { id: 'metalness', label: 'Metalness' },
        { id: 'roughness', label: 'Roughness' },
        { id: 'emissiveColor', label: 'Emissive' },
        { id: 'emissiveIntensity', label: 'Emissive Int' },
        { id: 'normal', label: 'Normal' },
      ];
    case 'material.mix':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 't', label: 'T' },
      ];
    case 'material.multiply':
    case 'material.add':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
    case 'material.clamp':
      return [
        { id: 'value', label: 'Value' },
        { id: 'min', label: 'Min' },
        { id: 'max', label: 'Max' },
      ];
    default:
      return [];
  }
};

/** The key parameter for this node, shown as a chip — or null if it has none. */
function nodeDetail(
  data: NodeForgeNode['data'],
  variables: ReturnType<typeof useEditorStore.getState>['variables'],
  dataAssets: ReturnType<typeof useEditorStore.getState>['dataAssets'],
): string | null {
  switch (data.nodeKind) {
    case 'event.keyDown':
    case 'event.keyUp': {
      const code = data.keyCode ?? 'KeyW';
      return `Key ${keyLabelByCode(code)}`;
    }
    case 'event.custom':
    case 'action.fireEvent':
      return `“${data.eventName ?? 'CustomEvent'}”`;
    case 'event.functionEntry':
    case 'logic.callFunction':
      return `“${data.functionName ?? 'MyFunction'}”`;
    case 'action.translate':
    case 'action.rotate': {
      const unit = data.nodeKind === 'action.rotate' ? '°/s' : 'u/s';
      return `${(data.axis ?? 'z').toUpperCase()} axis · ${data.amount ?? 0} ${unit}`;
    }
    case 'value.number':
      return String(data.numberValue ?? 0);
    case 'value.string':
      return `“${data.stringValue ?? ''}”`;
    case 'value.boolean':
      return data.booleanValue ? 'True' : 'False';
    case 'value.vector3':
      return `[${(data.vectorValue ?? [0, 0, 0]).join(', ')}]`;
    case 'variable.get':
    case 'variable.set':
      return data.variableId
        ? `Variable · ${variables.find((variable) => variable.id === data.variableId)?.name ?? data.variableId}`
        : 'No variable selected';
    case 'data.tableGet': {
      const table = dataAssets.find((item) => item.id === data.tableId);
      const column = table?.columns.find((item) => item.id === data.columnId);
      return table ? `${table.name} · ${data.rowKey || 'row'} · ${column?.name ?? 'column'}` : 'No Data Asset selected';
    }
    case 'save.write':
    case 'save.load':
    case 'save.clear':
    case 'save.has':
      return data.saveSlot ?? 'slot1';
    case 'action.setTimeScale':
      return `${Number(data.numberValue ?? 1)}×`;
    case 'action.print':
      return `“${data.message ?? ''}”`;
    case 'action.setQuality':
      return data.qualityLevel ?? 'High';
    default:
      return null;
  }
}

export function NodeForgeGraphNode({ id, data, selected }: NodeProps<NodeForgeNode>) {
  const Icon = kindIcon[data.nodeKind] ?? toneIcon[data.tone];
  const isEvent = data.tone === 'event';
  const isValueProducer = valueProducerKinds.has(data.nodeKind);
  const valueInputs = valueInputsFor(data.nodeKind);
  const variables = useEditorStore((state) => state.variables);
  const dataAssets = useEditorStore((state) => state.dataAssets);
  const detail = nodeDetail(data, variables, dataAssets);
  const storeSelected = useEditorStore((state) => state.selectedGraphNodeId === id);
  const isSelected = selected || storeSelected;
  // Runtime error this node threw during the current Play session (see tickRuntime executeFrom) — paint
  // a badge so the user sees exactly which node failed, not just a console line.
  const runtimeError = useEditorStore((state) => state.runtimeNodeErrors[id]);

  // Comment frame: a resizable, pin-less note that sits BEHIND real nodes — purely organizational.
  // Rendered after the hooks above so the hook count never changes between node kinds.
  if (data.nodeKind === 'comment.note') {
    const accent = data.commentColor || '#7d8aa5';
    return (
      <>
        <NodeResizer minWidth={160} minHeight={90} isVisible={isSelected} lineStyle={{ borderColor: accent }} handleStyle={{ background: accent }} />
        <div
          className={`nf-comment ${isSelected ? 'selected' : ''}`}
          style={{ borderColor: accent, background: `${accent}14` }}
          onClick={() => useEditorStore.getState().selectGraphNode(id)}
          onPointerDown={() => useEditorStore.getState().selectGraphNode(id)}
        >
          <textarea
            // `nodrag` stops React Flow from treating typing/drag-select inside the text as a node drag.
            className="nodrag nf-comment-text"
            style={{ color: accent }}
            value={data.message ?? ''}
            placeholder="Comment…"
            spellCheck={false}
            onChange={(event) => useEditorStore.getState().updateGraphNodeData(id, { message: event.target.value })}
          />
        </div>
      </>
    );
  }

  // Output data type: drives the value-out port color and its "Number/Bool/…" label.
  const outType: GraphValueType | 'any' | null = isValueProducer
    ? outputTypeOf[data.nodeKind] ?? (data.valueType as GraphValueType | undefined) ?? 'any'
    : null;

  const showInlineDescription = valueInputs.length === 0;
  const pinTop = valueInputs.length ? (detail ? 110 : 92) : 82;
  const pinStep = 28;

  // Handles are absolutely positioned, so reserve height for the lowest pin/label.
  let pinBottom = valueInputs.length ? pinTop + (valueInputs.length - 1) * pinStep + 30 : 0;
  if (data.nodeKind === 'logic.forLoop' || data.nodeKind === 'logic.forEachActor') pinBottom = Math.max(pinBottom, 124);
  if (data.nodeKind === 'logic.cast') pinBottom = Math.max(pinBottom, 122);
  // Raycast has 4 stacked outputs (Hit/Actor/Point/Distance).
  if (data.nodeKind === 'query.raycast') pinBottom = Math.max(pinBottom, pinTop + 3 * pinStep + 30);
  // Overlap Sphere has 3 stacked outputs (Hit/Actor/Count).
  if (data.nodeKind === 'query.overlapSphere') pinBottom = Math.max(pinBottom, pinTop + 2 * pinStep + 30);
  // Switch stacks one exec pin per case; Sequence 3; Flip Flop 2; Function entry 3 arg value-outs.
  const switchCases = data.nodeKind === 'logic.switch' ? data.switchCases ?? [] : [];
  if (data.nodeKind === 'logic.switch') pinBottom = Math.max(pinBottom, pinTop + switchCases.length * pinStep + 30);
  if (data.nodeKind === 'logic.sequence') pinBottom = Math.max(pinBottom, pinTop + 2 * pinStep + 30);
  if (data.nodeKind === 'logic.flipFlop') pinBottom = Math.max(pinBottom, pinTop + 1 * pinStep + 30);
  if (data.nodeKind === 'event.functionEntry') pinBottom = Math.max(pinBottom, pinTop + 2 * pinStep + 30);
  if (data.nodeKind === 'logic.callFunction' || data.nodeKind === 'action.spawnPrefab') pinBottom = Math.max(pinBottom, pinTop + valueInputs.length * pinStep + 30);

  const inputPinCount = (data.hasInput !== false && !isValueProducer ? 1 : 0) + valueInputs.length;
  const outputPinCount =
    (data.hasOutput !== false && !isValueProducer ? 1 : 0) +
    (isValueProducer && outType && data.nodeKind !== 'query.raycast' && data.nodeKind !== 'query.overlapSphere' ? 1 : 0) +
    (data.nodeKind === 'query.raycast' ? 4 : 0) +
    (data.nodeKind === 'query.overlapSphere' ? 3 : 0) +
    (data.nodeKind === 'logic.cast' ? 1 : 0) +
    (data.nodeKind === 'event.receiveDamage' ? 1 : 0) +
    (data.nodeKind === 'action.tweenProperty' ? 1 : 0) +
    (data.nodeKind === 'logic.forLoop' || data.nodeKind === 'logic.forEachActor' ? 2 : 0) +
    switchCases.length +
    (data.nodeKind === 'logic.sequence' ? 3 : 0) +
    (data.nodeKind === 'logic.flipFlop' ? 2 : 0) +
    (data.nodeKind === 'event.functionEntry' ? 3 : 0) +
    (data.nodeKind === 'logic.callFunction' || data.nodeKind === 'action.spawnPrefab' ? 1 : 0) +
    (data.nodeKind === 'event.custom' ? 1 : 0);
  const nodeMode = isEvent ? 'Event' : isValueProducer ? 'Pure' : 'Exec';

  return (
    <div
      className={`nodeforge-node ${data.tone} ${isEvent ? 'is-event' : ''} ${isValueProducer ? 'is-pure' : ''} ${valueInputs.length ? 'has-value-inputs' : ''} ${isSelected ? 'selected' : ''} ${runtimeError ? 'has-error' : ''}`}
      style={pinBottom ? { minHeight: pinBottom } : undefined}
      aria-selected={isSelected}
      aria-invalid={runtimeError ? true : undefined}
      title={runtimeError ? `Runtime error: ${runtimeError}` : `${data.label} · ${data.category}`}
      // Select directly so the inspector always opens, independent of ReactFlow's
      // pointer-based selection (which can be unreliable inside a docked panel).
      onClick={() => useEditorStore.getState().selectGraphNode(id)}
      onPointerDown={() => useEditorStore.getState().selectGraphNode(id)}
    >
      {runtimeError && (
        <span className="nfn-error-badge" title={runtimeError} aria-label={`Runtime error: ${runtimeError}`}>
          <AlertTriangle size={12} aria-hidden /> error
        </span>
      )}
      {inputPinCount > 0 && <span className="nfn-port-rail in" aria-hidden />}
      {outputPinCount > 0 && <span className="nfn-port-rail out" aria-hidden />}
      <span className="nfn-selection-mark" aria-hidden />

      {data.hasInput !== false && !isValueProducer && (
        <Handle id="exec-in" className="node-port exec-port target" type="target" position={Position.Left} style={{ top: 42 }} />
      )}

      {valueInputs.map((input, index) => (
        <span key={`${input.id}-row`} className="nfn-port-row" style={{ top: pinTop + index * pinStep }} aria-hidden />
      ))}
      {valueInputs.map((input, index) => (
        <Handle
          key={input.id}
          id={input.id}
          className="node-port value-port target"
          type="target"
          position={Position.Left}
          style={{ top: pinTop + index * pinStep }}
        />
      ))}
      {/* Labels aligned to each input handle so it's clear which pin is which. */}
      {valueInputs.map((input, index) => (
        <span key={`${input.id}-label`} className="nfn-port-label in" style={{ top: pinTop + index * pinStep }}>
          {input.label}
        </span>
      ))}

      <header className="nfn-head">
        <span className="nfn-badge">
          <Icon size={14} aria-hidden />
        </span>
        <div className="nfn-titles">
          <span className="nfn-kicker">{data.category}</span>
          <strong className="nfn-label">{data.label}</strong>
        </div>
        <span className="nfn-mode">{nodeMode}</span>
      </header>

      {(detail || (showInlineDescription && data.description)) && (
        <div className="nfn-body">
          {detail && <span className="nfn-detail">{detail}</span>}
          {showInlineDescription && data.description && <p className="nfn-desc">{data.description}</p>}
        </div>
      )}

      {!valueInputs.length && (
        <footer className="nfn-foot" aria-hidden>
          <span>{inputPinCount} in</span>
          <span>{outputPinCount} out</span>
        </footer>
      )}

      {data.hasOutput !== false && !isValueProducer && (
        <Handle id="exec-out" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: 42 }} />
      )}

      {isValueProducer && outType && data.nodeKind !== 'query.raycast' && (
        <>
          <Handle
            id="value-out"
            className={`node-port value-port value-${outType} source`}
            type="source"
            position={Position.Right}
            style={{ top: pinTop }}
          />
          <span className="nfn-port-label out" style={{ top: pinTop }}>
            {valueTypeLabels[outType]}
          </span>
        </>
      )}

      {/* Raycast: four stacked outputs — Hit (bool), Actor (reference), Point (vec3), Distance (number). */}
      {data.nodeKind === 'query.raycast' &&
        (
          [
            { id: 'value-out', label: 'Hit', type: 'boolean' as const },
            { id: 'actor', label: 'Actor', type: 'any' as const },
            { id: 'point', label: 'Point', type: 'vector3' as const },
            { id: 'distance', label: 'Distance', type: 'number' as const },
          ]
        ).map((out, index) => (
          <span key={out.id}>
            <Handle
              id={out.id}
              className={`node-port value-port value-${out.type} source`}
              type="source"
              position={Position.Right}
              style={{ top: pinTop + index * pinStep }}
            />
            <span className="nfn-port-label out" style={{ top: pinTop + index * pinStep }}>
              {out.label}
            </span>
          </span>
        ))}

      {/* Overlap Sphere: three stacked outputs — Hit (bool), Actor (nearest reference), Count (number). */}
      {data.nodeKind === 'query.overlapSphere' &&
        (
          [
            { id: 'value-out', label: 'Hit', type: 'boolean' as const },
            { id: 'actor', label: 'Actor', type: 'any' as const },
            { id: 'count', label: 'Count', type: 'number' as const },
          ]
        ).map((out, index) => (
          <span key={out.id}>
            <Handle
              id={out.id}
              className={`node-port value-port value-${out.type} source`}
              type="source"
              position={Position.Right}
              style={{ top: pinTop + index * pinStep }}
            />
            <span className="nfn-port-label out" style={{ top: pinTop + index * pinStep }}>
              {out.label}
            </span>
          </span>
        ))}

      {/* Cast is an exec gate that ALSO outputs the validated actor as a typed reference ("As <Blueprint>"),
          wired into a Get/Set Object Var's Target — the Unreal "Cast → As BP_X" pin. */}
      {data.nodeKind === 'logic.cast' && (
        <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: pinTop + pinStep }} />
      )}

      {/* On Receive Damage: an event (exec-out above) that ALSO exposes the HP lost on this hit as a value-out. */}
      {data.nodeKind === 'event.receiveDamage' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop - 4 }}>
            Damage
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: pinTop + 2 }} />
        </>
      )}

      {/* Switch: one exec pin per case (matched by VALUE); the default exec-out above is "Default". */}
      {data.nodeKind === 'logic.switch' && (
        <>
          <span className="nfn-pin-label" style={{ top: 30 }}>
            Default
          </span>
          {switchCases.map((caseLabel, index) => (
            <span key={`case-${index}`}>
              <span className="nfn-pin-label" style={{ top: pinTop + index * pinStep - 4 }}>
                {caseLabel || `case ${index}`}
              </span>
              <Handle
                id={`case-${index}`}
                className="node-port exec-port source"
                type="source"
                position={Position.Right}
                style={{ top: pinTop + index * pinStep + 2 }}
              />
            </span>
          ))}
        </>
      )}

      {/* Sequence: Then 0 → Then 1 → Then 2 fire in order. */}
      {data.nodeKind === 'logic.sequence' &&
        [0, 1, 2].map((index) => (
          <span key={`then-${index}`}>
            <span className="nfn-pin-label" style={{ top: pinTop + index * pinStep - 4 }}>
              Then {index}
            </span>
            <Handle
              id={`then-${index}`}
              className="node-port exec-port source"
              type="source"
              position={Position.Right}
              style={{ top: pinTop + index * pinStep + 2 }}
            />
          </span>
        ))}

      {/* Flip Flop: alternates A / B per trigger. */}
      {data.nodeKind === 'logic.flipFlop' &&
        (['flip-a', 'flip-b'] as const).map((handle, index) => (
          <span key={handle}>
            <span className="nfn-pin-label" style={{ top: pinTop + index * pinStep - 4 }}>
              {index === 0 ? 'A' : 'B'}
            </span>
            <Handle
              id={handle}
              className="node-port exec-port source"
              type="source"
              position={Position.Right}
              style={{ top: pinTop + index * pinStep + 2 }}
            />
          </span>
        ))}

      {/* Function entry: the call's A/B/C arguments come out here. */}
      {data.nodeKind === 'event.functionEntry' &&
        (['arg-a', 'arg-b', 'arg-c'] as const).map((handle, index) => (
          <span key={handle}>
            <span className="nfn-pin-label" style={{ top: pinTop + index * pinStep - 4 }}>
              {['A', 'B', 'C'][index]}
            </span>
            <Handle
              id={handle}
              className="node-port value-port source"
              type="source"
              position={Position.Right}
              style={{ top: pinTop + index * pinStep + 2 }}
            />
          </span>
        ))}

      {/* Call Function: the value a Return node set inside the function. */}
      {data.nodeKind === 'logic.callFunction' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop + valueInputs.length * pinStep - 4 }}>
            Return
          </span>
          <Handle
            id="value-out"
            className="node-port value-port source"
            type="source"
            position={Position.Right}
            style={{ top: pinTop + valueInputs.length * pinStep + 2 }}
          />
        </>
      )}

      {/* Spawn Prefab: a reference to the actor it just spawned (chain into Set Object Var etc.). */}
      {data.nodeKind === 'action.spawnPrefab' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop + valueInputs.length * pinStep - 4 }}>
            Actor
          </span>
          <Handle
            id="value-out"
            className="node-port value-port source"
            type="source"
            position={Position.Right}
            style={{ top: pinTop + valueInputs.length * pinStep + 2 }}
          />
        </>
      )}

      {/* Custom Event: the payload the firing Fire Event carried. */}
      {data.nodeKind === 'event.custom' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop - 4 }}>
            Payload
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: pinTop + 2 }} />
        </>
      )}

      {/* Tween: the standard exec-out (above) continues immediately; "Done" fires when the animation completes. */}
      {data.nodeKind === 'action.tweenProperty' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop - 4 }}>
            Done
          </span>
          <Handle id="exec-done" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: pinTop + 2 }} />
        </>
      )}

      {/* For Loop: the standard exec-out (above) is "Completed". These extra pins are the per-iteration
          "Body" exec output and the current loop index value-out (Unreal-style ForLoop). */}
      {data.nodeKind === 'logic.forLoop' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop - 4 }}>
            Body
          </span>
          <Handle id="exec-body" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: pinTop + 2 }} />
          <span className="nfn-pin-label" style={{ top: pinTop + pinStep - 4 }}>
            Index
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: pinTop + pinStep + 2 }} />
        </>
      )}

      {/* For Each Actor: "Body" fires per matching actor (current actor on value-out); default exec-out = "Completed". */}
      {data.nodeKind === 'logic.forEachActor' && (
        <>
          <span className="nfn-pin-label" style={{ top: pinTop - 4 }}>
            Body
          </span>
          <Handle id="exec-body" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: pinTop + 2 }} />
          <span className="nfn-pin-label" style={{ top: pinTop + pinStep - 4 }}>
            Actor
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: pinTop + pinStep + 2 }} />
        </>
      )}
    </div>
  );
}
