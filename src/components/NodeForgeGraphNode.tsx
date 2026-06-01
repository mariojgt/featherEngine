import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, GitBranch, Radio, Sigma, Volume2, Waypoints, Zap } from 'lucide-react';
import type { GraphNodeTone, NodeForgeNode } from '../types';

const toneIcon: Record<GraphNodeTone, typeof Zap> = {
  event: Zap,
  logic: GitBranch,
  math: Sigma,
  runtime: Waypoints,
  physics: Box,
  audio: Volume2,
  value: Radio,
};

export function NodeForgeGraphNode({ data, selected }: NodeProps<NodeForgeNode>) {
  const Icon = toneIcon[data.tone];
  const detail =
    data.keyCode ??
    data.eventName ??
    (data.axis ? `${data.axis.toUpperCase()} ${data.amount ?? ''}` : data.nodeKind);

  return (
    <div className={`nodeforge-node ${data.tone} ${selected ? 'selected' : ''}`}>
      {data.hasInput !== false && <Handle className="node-port target" type="target" position={Position.Left} />}
      <div className="nodeforge-node-header">
        <span className="nodeforge-node-kicker">
          <Icon size={13} aria-hidden />
          {data.category}
        </span>
      </div>
      <strong>{data.label}</strong>
      <span className="nodeforge-node-detail">{detail}</span>
      <p>{data.description}</p>
      <div className="nodeforge-node-footer">
        <span>Exec</span>
        <span>Object</span>
      </div>
      {data.hasOutput !== false && <Handle className="node-port source" type="source" position={Position.Right} />}
    </div>
  );
}
