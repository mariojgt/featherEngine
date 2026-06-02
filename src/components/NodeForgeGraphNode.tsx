import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';
import {
  Ampersand,
  ArrowLeftRight,
  Axis3d,
  Box,
  Crosshair,
  Database,
  Equal,
  GitBranch,
  GitMerge,
  Hash,
  Image,
  Keyboard,
  LayoutDashboard,
  Move,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCw,
  Save,
  Send,
  Sigma,
  Palette,
  Spline,
  Sparkles,
  SlidersHorizontal,
  Terminal,
  ToggleLeft,
  Trash2,
  Type as TextIcon,
  Volume2,
  Waypoints,
  Wind,
  Zap,
} from 'lucide-react';
import type { GraphNodeKind, GraphNodeTone, NodeForgeNode } from '../types';

const keyLabels: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
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
  'event.triggerEnter': Crosshair,
  'logic.branch': GitBranch,
  'logic.compare': Equal,
  'logic.and': Ampersand,
  'logic.or': GitMerge,
  'math.add': Plus,
  'math.clamp': ArrowLeftRight,
  'math.lerp': Spline,
  'value.number': Hash,
  'value.string': TextIcon,
  'value.boolean': ToggleLeft,
  'value.vector3': Axis3d,
  'variable.get': Database,
  'variable.set': Database,
  'data.tableGet': Database,
  'action.translate': Move,
  'action.rotate': RotateCw,
  'action.applyForce': Wind,
  'action.fireEvent': Send,
  'action.spawnObject': Sparkles,
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
  'query.grounded': Crosshair,
  'action.move': Move,
  'action.jump': Wind,
  'action.setCamera': Crosshair,
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
  'math.add',
  'math.clamp',
  'math.lerp',
  'value.number',
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
  'query.grounded',
  'animator.getParam',
  'animator.getState',
]);

const valueInputsFor = (kind: GraphNodeKind): Array<{ id: string; label: string }> => {
  switch (kind) {
    case 'logic.branch':
      return [{ id: 'condition', label: 'Condition' }];
    case 'logic.compare':
    case 'logic.and':
    case 'logic.or':
    case 'math.add':
      return [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
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
    case 'variable.setObject':
      return [{ id: 'value', label: 'Value' }];
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
      return [
        { id: 'vector', label: 'Force' },
        { id: 'amount', label: 'Amount' },
      ];
    case 'action.print':
      return [{ id: 'message', label: 'Message' }];
    case 'animator.setFloat':
    case 'animator.setBool':
      return [{ id: 'value', label: 'Value' }];
    case 'action.move':
      return [
        { id: 'vector', label: 'Direction' },
        { id: 'speed', label: 'Speed' },
      ];
    case 'action.setCamera':
      return [
        { id: 'distance', label: 'Distance' },
        { id: 'height', label: 'Height' },
      ];
    case 'action.setRagdoll':
      return [{ id: 'on', label: 'On' }];
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
      return `Key ${keyLabels[code] ?? code}`;
    }
    case 'event.custom':
    case 'action.fireEvent':
      return `“${data.eventName ?? 'CustomEvent'}”`;
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
      return data.saveSlot ?? 'slot1';
    case 'action.print':
      return `“${data.message ?? ''}”`;
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

  return (
    <div
      className={`nodeforge-node ${data.tone} ${isEvent ? 'is-event' : ''} ${selected || storeSelected ? 'selected' : ''}`}
      // Select directly so the inspector always opens, independent of ReactFlow's
      // pointer-based selection (which can be unreliable inside a docked panel).
      onClick={() => useEditorStore.getState().selectGraphNode(id)}
      onPointerDown={() => useEditorStore.getState().selectGraphNode(id)}
    >
      {data.hasInput !== false && !isValueProducer && (
        <Handle id="exec-in" className="node-port exec-port target" type="target" position={Position.Left} />
      )}

      {valueInputs.map((input, index) => (
        <Handle
          key={input.id}
          id={input.id}
          className="node-port value-port target"
          type="target"
          position={Position.Left}
          style={{ top: 82 + index * 22 }}
        />
      ))}

      <header className="nfn-head">
        <span className="nfn-badge">
          <Icon size={15} aria-hidden />
        </span>
        <div className="nfn-titles">
          <span className="nfn-kicker">{data.category}</span>
          <strong className="nfn-label">{data.label}</strong>
        </div>
      </header>

      <div className="nfn-body">
        {detail && <span className="nfn-detail">{detail}</span>}
        {valueInputs.length > 0 && (
          <div className="nfn-inputs">
            {valueInputs.map((input) => (
              <span key={input.id}>{input.label}</span>
            ))}
          </div>
        )}
        <p className="nfn-desc">{data.description}</p>
      </div>

      {data.hasOutput !== false && !isValueProducer && (
        <Handle id="exec-out" className="node-port exec-port source" type="source" position={Position.Right} />
      )}

      {isValueProducer && (
        <Handle
          id="value-out"
          className="node-port value-port source"
          type="source"
          position={Position.Right}
          style={{ top: 82 }}
        />
      )}
    </div>
  );
}
