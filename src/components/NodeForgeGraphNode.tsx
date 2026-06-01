import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Ampersand,
  ArrowLeftRight,
  Axis3d,
  Box,
  Crosshair,
  Equal,
  GitBranch,
  GitMerge,
  Keyboard,
  Move,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCw,
  Send,
  Sigma,
  Spline,
  Sparkles,
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
};

const kindIcon: Partial<Record<GraphNodeKind, typeof Zap>> = {
  'event.start': Play,
  'event.update': RefreshCw,
  'event.keyDown': Keyboard,
  'event.keyUp': Keyboard,
  'event.custom': Radio,
  'event.collisionEnter': Crosshair,
  'logic.branch': GitBranch,
  'logic.compare': Equal,
  'logic.and': Ampersand,
  'logic.or': GitMerge,
  'math.add': Plus,
  'math.clamp': ArrowLeftRight,
  'math.lerp': Spline,
  'value.vector3': Axis3d,
  'action.translate': Move,
  'action.rotate': RotateCw,
  'action.applyForce': Wind,
  'action.fireEvent': Send,
  'action.spawnObject': Sparkles,
  'action.playSound': Volume2,
};

/** The key parameter for this node, shown as a chip — or null if it has none. */
function nodeDetail(data: NodeForgeNode['data']): string | null {
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
    default:
      return null;
  }
}

export function NodeForgeGraphNode({ data, selected }: NodeProps<NodeForgeNode>) {
  const Icon = kindIcon[data.nodeKind] ?? toneIcon[data.tone];
  const isEvent = data.tone === 'event';
  const detail = nodeDetail(data);

  return (
    <div className={`nodeforge-node ${data.tone} ${isEvent ? 'is-event' : ''} ${selected ? 'selected' : ''}`}>
      {data.hasInput !== false && (
        <Handle className="node-port target" type="target" position={Position.Left} />
      )}

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
        <p className="nfn-desc">{data.description}</p>
      </div>

      {data.hasOutput !== false && (
        <Handle className="node-port source" type="source" position={Position.Right} />
      )}
    </div>
  );
}
