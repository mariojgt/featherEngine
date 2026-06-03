import type { Edge } from '@xyflow/react';
import type { DataAsset, NodeForgeNode, ProjectVariable, Scene, SceneObject, ScriptBlueprint } from '../../types';

import { defaultSceneEnvironment } from '../../three/environmentSettings';
import { defaultPhysics, defaultRenderer, defaultTransform } from './defaults';
import { makeNodeData } from './graph';

export const blueprintId = 'blueprint-player-controller';
export const graphId = 'graph-player-controller';

export const starterObjects: SceneObject[] = [
  {
    id: 'obj-player',
    name: 'Player',
    kind: 'cube',
    transform: defaultTransform([0, 1, 0]),
    renderer: defaultRenderer('cube', '#5B8CFF'),
    physics: defaultPhysics('dynamic', 'box'),
    script: { blueprintId, graphId, enabled: true },
  },
  {
    id: 'obj-ground',
    name: 'Ground',
    kind: 'plane',
    transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8, 1] },
    renderer: defaultRenderer('plane', '#2B3345'),
    physics: defaultPhysics('fixed', 'box'),
  },
  {
    id: 'obj-enemy',
    name: 'Enemy',
    kind: 'sphere',
    transform: defaultTransform([2.6, 0.75, -1.2]),
    renderer: defaultRenderer('sphere', '#FF6B6B'),
    physics: defaultPhysics('dynamic', 'sphere'),
  },
  {
    id: 'obj-light',
    name: 'Directional Light',
    kind: 'light',
    transform: defaultTransform([4, 6, 3]),
  },
  {
    id: 'obj-camera',
    name: 'Main Camera',
    kind: 'camera',
    transform: defaultTransform([4, 3, 6]),
  },
];

export const starterSceneId = 'scene-main';

export const starterScenes: Scene[] = [
  { id: starterSceneId, name: 'Main', objects: starterObjects, environment: defaultSceneEnvironment() },
];

export const starterVariables: ProjectVariable[] = [
  {
    id: 'var-score',
    name: 'Score',
    type: 'number',
    defaultValue: 0,
    persistent: true,
    createdAt: Date.now(),
  },
  {
    id: 'var-player-name',
    name: 'PlayerName',
    type: 'string',
    defaultValue: 'Hero',
    persistent: true,
    createdAt: Date.now(),
  },
  {
    id: 'var-has-key',
    name: 'HasKey',
    type: 'boolean',
    defaultValue: false,
    persistent: true,
    createdAt: Date.now(),
  },
];

export const starterDataAssets: DataAsset[] = [
  {
    id: 'table-items',
    name: 'Items',
    columns: [
      { id: 'col-display-name', name: 'DisplayName', type: 'string' },
      { id: 'col-value', name: 'Value', type: 'number' },
    ],
    rows: [
      {
        id: 'row-potion',
        key: 'potion',
        values: { 'col-display-name': 'Potion', 'col-value': 25 },
      },
      {
        id: 'row-key',
        key: 'key',
        values: { 'col-display-name': 'Small Key', 'col-value': 1 },
      },
    ],
    createdAt: Date.now(),
  },
];

export const starterBlueprints: ScriptBlueprint[] = [
  {
    id: blueprintId,
    name: 'Player Controller',
    description: 'Reusable movement Blueprint that can be attached to any scene object.',
    graphId,
    color: '#5B8CFF',
    createdAt: Date.now(),
  },
];

export const starterNodes: NodeForgeNode[] = [
  {
    id: 'node-start',
    type: 'nodeforge',
    position: { x: 32, y: 72 },
    data: makeNodeData('Start', 'Events', { hasInput: false }),
  },
  {
    id: 'node-update',
    type: 'nodeforge',
    position: { x: 232, y: 72 },
    data: makeNodeData('Update', 'Events', { hasInput: false }),
  },
  {
    id: 'node-key',
    type: 'nodeforge',
    position: { x: 432, y: 24 },
    data: makeNodeData('Key Down', 'Events', { keyCode: 'KeyW', hasInput: false }),
  },
  {
    id: 'node-move',
    type: 'nodeforge',
    position: { x: 632, y: 72 },
    data: makeNodeData('Translate', 'Runtime', { axis: 'z', amount: -3.6, hasOutput: false }),
  },
];

export const starterEdges: Edge[] = [
  { id: 'edge-key-move', source: 'node-key', target: 'node-move', animated: true, type: 'smoothstep' },
];
