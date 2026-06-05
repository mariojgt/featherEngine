import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditorStore } from '../store/editorStore';
import {
  Ampersand,
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
  Radio,
  RefreshCw,
  RotateCw,
  Save,
  ScanLine,
  Search,
  Send,
  Sigma,
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
  'query.raycast': 'boolean',
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
  'action.setPosition': Move,
  'action.setRotation': RotateCw,
  'action.setScale': Scaling,
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
      return [{ id: 'value', label: 'Value' }];
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
    case 'action.setVelocity':
      return [{ id: 'vector', label: 'Velocity' }];
    case 'query.velocity':
      return [{ id: 'target', label: 'Target' }];
    case 'action.print':
      return [{ id: 'message', label: 'Message' }];
    case 'action.fireEvent':
      return [{ id: 'target', label: 'Target' }];
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

  // Output data type: drives the value-out port color and its "Number/Bool/…" label.
  const outType: GraphValueType | 'any' | null = isValueProducer
    ? outputTypeOf[data.nodeKind] ?? (data.valueType as GraphValueType | undefined) ?? 'any'
    : null;

  // Handles are absolutely positioned, so reserve height for the lowest pin/label.
  let pinBottom = valueInputs.length ? 82 + (valueInputs.length - 1) * 22 + 18 : 0;
  if (data.nodeKind === 'logic.forLoop' || data.nodeKind === 'logic.forEachActor') pinBottom = Math.max(pinBottom, 124);
  if (data.nodeKind === 'logic.cast') pinBottom = Math.max(pinBottom, 122);
  // Raycast has 4 stacked outputs (Hit/Actor/Point/Distance).
  if (data.nodeKind === 'query.raycast') pinBottom = Math.max(pinBottom, 168);

  return (
    <div
      className={`nodeforge-node ${data.tone} ${isEvent ? 'is-event' : ''} ${selected || storeSelected ? 'selected' : ''}`}
      style={pinBottom ? { minHeight: pinBottom } : undefined}
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
      {/* Labels aligned to each input handle so it's clear which pin is which. */}
      {valueInputs.map((input, index) => (
        <span key={`${input.id}-label`} className="nfn-port-label in" style={{ top: 82 + index * 22 }}>
          {input.label}
        </span>
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
        {/* Input labels are now drawn beside their handles; only show the description
            when there are no value inputs, so the port rows stay readable. */}
        {valueInputs.length === 0 && data.description && <p className="nfn-desc">{data.description}</p>}
      </div>

      {data.hasOutput !== false && !isValueProducer && (
        <Handle id="exec-out" className="node-port exec-port source" type="source" position={Position.Right} />
      )}

      {isValueProducer && outType && data.nodeKind !== 'query.raycast' && (
        <>
          <Handle
            id="value-out"
            className={`node-port value-port value-${outType} source`}
            type="source"
            position={Position.Right}
            style={{ top: 82 }}
          />
          <span className="nfn-port-label out" style={{ top: 82 }}>
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
              style={{ top: 82 + index * 22 }}
            />
            <span className="nfn-port-label out" style={{ top: 82 + index * 22 }}>
              {out.label}
            </span>
          </span>
        ))}

      {/* Cast is an exec gate that ALSO outputs the validated actor as a typed reference ("As <Blueprint>"),
          wired into a Get/Set Object Var's Target — the Unreal "Cast → As BP_X" pin. */}
      {data.nodeKind === 'logic.cast' && (
        <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: 104 }} />
      )}

      {/* On Receive Damage: an event (exec-out above) that ALSO exposes the HP lost on this hit as a value-out. */}
      {data.nodeKind === 'event.receiveDamage' && (
        <>
          <span className="nfn-pin-label" style={{ position: 'absolute', right: 14, top: 78, fontSize: 10, opacity: 0.7 }}>
            Damage
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: 84 }} />
        </>
      )}

      {/* For Loop: the standard exec-out (above) is "Completed". These extra pins are the per-iteration
          "Body" exec output and the current loop index value-out (Unreal-style ForLoop). */}
      {data.nodeKind === 'logic.forLoop' && (
        <>
          <span className="nfn-pin-label" style={{ position: 'absolute', right: 14, top: 78, fontSize: 10, opacity: 0.7 }}>
            Body
          </span>
          <Handle id="exec-body" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: 84 }} />
          <span className="nfn-pin-label" style={{ position: 'absolute', right: 14, top: 100, fontSize: 10, opacity: 0.7 }}>
            Index
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: 106 }} />
        </>
      )}

      {/* For Each Actor: "Body" fires per matching actor (current actor on value-out); default exec-out = "Completed". */}
      {data.nodeKind === 'logic.forEachActor' && (
        <>
          <span className="nfn-pin-label" style={{ position: 'absolute', right: 14, top: 78, fontSize: 10, opacity: 0.7 }}>
            Body
          </span>
          <Handle id="exec-body" className="node-port exec-port source" type="source" position={Position.Right} style={{ top: 84 }} />
          <span className="nfn-pin-label" style={{ position: 'absolute', right: 14, top: 100, fontSize: 10, opacity: 0.7 }}>
            Actor
          </span>
          <Handle id="value-out" className="node-port value-port source" type="source" position={Position.Right} style={{ top: 106 }} />
        </>
      )}
    </div>
  );
}
