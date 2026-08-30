import type {
  CharacterControllerComponent,
  FractureComponent,
  GraphValue,
  PhysicsComponent,
  SceneObjectKind,
  Vector3Tuple,
} from '../types';

export const CREATOR_ROLE_IDS = [
  'player',
  'collectible',
  'door',
  'enemy',
  'hazard',
  'destructible',
  'moving-platform',
] as const;

export type CreatorRoleId = (typeof CREATOR_ROLE_IDS)[number];

/** A game concept composed from Feather's existing, normally-serialized systems. */
export interface CreatorRole {
  /** String ids keep the orchestration layer open to future plugin-provided roles. */
  id: string;
  name: string;
  description: string;
  icon: string;
  compatibleKinds?: SceneObjectKind[];
  /** The one normal editable blueprint attached to the object, when this role is script-driven. */
  behaviorPresetId?: string;
  /** Defaults used by Add -> role. Make It can apply the same role to an existing object. */
  create: {
    kind: SceneObjectKind;
    name: string;
    color?: string;
  };
  physics?: Partial<PhysicsComponent>;
  /** Built-in character controller configuration. It is part of the normal SceneObject format/runtime. */
  character?: Partial<CharacterControllerComponent>;
  variables?: Record<string, GraphValue>;
  tags?: string[];
  fracture?: Partial<FractureComponent>;
}

export interface CreateRoleObjectOptions {
  kind?: SceneObjectKind;
  name?: string;
  position?: Vector3Tuple;
  color?: string;
  parentId?: string;
  physics?: Partial<PhysicsComponent>;
}

export interface CreatorRoleActionResult {
  ok: boolean;
  roleId: string;
  objectId?: string;
  blueprintId?: string;
  /** True only when this call created the scene object, not when Make It changed an existing object. */
  created: boolean;
  /** Whether the authored project representation differs from before this call. */
  changed: boolean;
  error?: 'unknown-role' | 'object-not-found' | 'incompatible-kind' | 'behavior-attach-failed';
}

const MESH_KINDS: SceneObjectKind[] = ['empty', 'cube', 'sphere', 'capsule', 'plane'];

export const CREATOR_ROLES: CreatorRole[] = [
  {
    id: 'player',
    name: 'Player',
    description: 'A ready-to-control third-person player with movement, jumping, and a follow camera.',
    icon: '🎮',
    compatibleKinds: MESH_KINDS,
    create: { kind: 'capsule', name: 'Player', color: '#5B8CFF' },
    character: { enabled: true, cameraFollow: true },
    tags: ['player'],
  },
  {
    id: 'collectible',
    name: 'Collectible',
    description: 'Adds to Score when the player touches it, then disappears.',
    icon: '💰',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'collectible',
    create: { kind: 'sphere', name: 'Collectible', color: '#FFD45A' },
    physics: { enabled: true, bodyType: 'fixed', isTrigger: true },
    tags: ['collectible'],
  },
  {
    id: 'door',
    name: 'Door',
    description: 'A solid door the player can interact with to open and close.',
    icon: '🚪',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'door-on-interact',
    create: { kind: 'cube', name: 'Door', color: '#B7794B' },
    physics: { enabled: true, bodyType: 'fixed', isTrigger: false },
    variables: { interactable: true, interactPrompt: 'Open / Close' },
    tags: ['door', 'interactable'],
  },
  {
    id: 'enemy',
    name: 'Enemy',
    description: 'Chases the player, deals contact damage, and can be defeated.',
    icon: '👾',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'enemy',
    create: { kind: 'capsule', name: 'Enemy', color: '#E55C68' },
    physics: {
      enabled: true,
      bodyType: 'kinematic',
      isTrigger: false,
      gravityScale: 0,
      lockedRotation: [true, false, true],
    },
    tags: ['enemy'],
  },
  {
    id: 'hazard',
    name: 'Hazard',
    description: 'Damages objects that enter its trigger volume.',
    icon: '🔥',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'damage-zone',
    create: { kind: 'cube', name: 'Hazard', color: '#FF5A36' },
    physics: { enabled: true, bodyType: 'fixed', isTrigger: true },
    tags: ['hazard'],
  },
  {
    id: 'destructible',
    name: 'Destructible',
    description: 'Takes damage and shatters into physical chunks when destroyed.',
    icon: '💥',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'health-and-death',
    create: { kind: 'cube', name: 'Destructible', color: '#D69A5C' },
    physics: { enabled: true, bodyType: 'dynamic', isTrigger: false },
    tags: ['destructible'],
    fracture: { enabled: true, pattern: 'chunks', pieces: 3, impactThreshold: 6, focusImpact: true },
  },
  {
    id: 'moving-platform',
    name: 'Moving Platform',
    description: 'A solid platform that moves back and forth along its local X axis.',
    icon: '↔️',
    compatibleKinds: MESH_KINDS,
    behaviorPresetId: 'moving-platform',
    create: { kind: 'cube', name: 'Moving Platform', color: '#5B8CFF' },
    physics: { enabled: true, bodyType: 'fixed', isTrigger: false },
    tags: ['platform', 'moving-platform'],
  },
];

export const findCreatorRole = (id: string): CreatorRole | undefined =>
  CREATOR_ROLES.find((role) => role.id === id);
