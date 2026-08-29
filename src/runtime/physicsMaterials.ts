import type { PhysicsComponent, PhysicsMaterialPresetId } from '../types';

export interface PhysicsMaterialPreset {
  id: PhysicsMaterialPresetId;
  name: string;
  description: string;
  friction: number;
  restitution: number;
  linearDamping?: number;
  angularDamping?: number;
}

export const PHYSICS_MATERIAL_PRESETS: PhysicsMaterialPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Balanced general-purpose physical surface.',
    friction: 0.6,
    restitution: 0.05,
    linearDamping: 0,
    angularDamping: 0.05,
  },
  {
    id: 'rubber',
    name: 'Rubber',
    description: 'High grip with strong bounce, good for balls, tires, pads, and trampolines.',
    friction: 1.15,
    restitution: 0.82,
    linearDamping: 0.02,
    angularDamping: 0.08,
  },
  {
    id: 'slime',
    name: 'Slime',
    description: 'Sticky, damped, and softly bouncy.',
    friction: 1.35,
    restitution: 0.28,
    linearDamping: 0.45,
    angularDamping: 0.35,
  },
  {
    id: 'ice',
    name: 'Ice',
    description: 'Very slippery with a small bounce.',
    friction: 0.03,
    restitution: 0.08,
    linearDamping: 0,
    angularDamping: 0.01,
  },
  {
    id: 'metal',
    name: 'Metal',
    description: 'Low grip with a sharp, hard bounce.',
    friction: 0.32,
    restitution: 0.18,
    linearDamping: 0,
    angularDamping: 0.03,
  },
  {
    id: 'stone',
    name: 'Stone',
    description: 'Heavy-feeling rough surface with little bounce.',
    friction: 0.82,
    restitution: 0.03,
    linearDamping: 0,
    angularDamping: 0.06,
  },
  {
    id: 'wood',
    name: 'Wood',
    description: 'Medium grip and mild bounce for crates, planks, and props.',
    friction: 0.55,
    restitution: 0.12,
    linearDamping: 0,
    angularDamping: 0.05,
  },
  {
    id: 'mud',
    name: 'Mud',
    description: 'Sticky, dead surface that kills sliding and bouncing.',
    friction: 1.6,
    restitution: 0,
    linearDamping: 0.8,
    angularDamping: 0.55,
  },
];

export const physicsMaterialPresetIds = PHYSICS_MATERIAL_PRESETS.map((preset) => preset.id) as [
  PhysicsMaterialPresetId,
  ...PhysicsMaterialPresetId[],
];

export const findPhysicsMaterialPreset = (id: PhysicsMaterialPresetId | undefined) =>
  PHYSICS_MATERIAL_PRESETS.find((preset) => preset.id === id) ?? PHYSICS_MATERIAL_PRESETS[0];

export const applyPhysicsMaterialPreset = (
  physics: PhysicsComponent,
  presetId: PhysicsMaterialPresetId,
): PhysicsComponent => {
  const preset = findPhysicsMaterialPreset(presetId);
  return {
    ...physics,
    materialPreset: preset.id,
    friction: preset.friction,
    restitution: preset.restitution,
    linearDamping: preset.linearDamping ?? physics.linearDamping,
    angularDamping: preset.angularDamping ?? physics.angularDamping,
  };
};

export interface PhysicsQuickPreset {
  id: string;
  label: string;
  hint: string;
  patch: Partial<PhysicsComponent>;
}

/** One-click "make this object a <thing>" physics configs for the common cases — so you don't have to
 *  hand-tune body type, collider, material, damping and axis locks every time. Each applies a complete
 *  ready-made setup (and enables physics) on the selected object. Shared by the inspector's quick-physics
 *  buttons and the AI assistant's apply_physics_preset tool so both produce identical setups. */
export const PHYSICS_QUICK_PRESETS: PhysicsQuickPreset[] = [
  {
    id: 'wall-or-floor',
    label: 'Wall / Floor',
    hint: 'Immovable solid. Default material.',
    patch: { enabled: true, bodyType: 'fixed', collider: 'box', materialPreset: 'default', isTrigger: false },
  },
  {
    id: 'scenery-mesh',
    label: 'Scenery (mesh)',
    hint: 'Immovable but hugs the model exactly. Use on imported props/terrain props.',
    patch: { enabled: true, bodyType: 'fixed', collider: 'mesh', materialPreset: 'default', isTrigger: false },
  },
  {
    id: 'pushable-crate',
    label: 'Pushable crate',
    hint: 'Dynamic box that slides and can be knocked over, but won\u2019t tip from tiny bumps.',
    patch: { enabled: true, bodyType: 'dynamic', collider: 'box', materialPreset: 'wood', mass: 6, friction: 0.85, restitution: 0.08, linearDamping: 0.1, angularDamping: 0.4, lockedRotation: [true, true, true] },
  },
  {
    id: 'bouncy-ball',
    label: 'Bouncy ball',
    hint: 'Light sphere that rolls and bounces.',
    patch: { enabled: true, bodyType: 'dynamic', collider: 'sphere', materialPreset: 'rubber', mass: 1, friction: 0.3, restitution: 0.85, linearDamping: 0.05, angularDamping: 0.2 },
  },
  {
    id: 'light-prop',
    label: 'Light prop',
    hint: 'Small box that blows around in scene wind and knocks over easily.',
    patch: { enabled: true, bodyType: 'dynamic', collider: 'box', materialPreset: 'wood', mass: 1, friction: 0.5, restitution: 0.35, windInfluence: 0.8, knockOverThreshold: 2 },
  },
  {
    id: 'ice-floor',
    label: 'Ice floor',
    hint: 'Very slippery static floor — objects skate across it.',
    patch: { enabled: true, bodyType: 'fixed', collider: 'box', materialPreset: 'ice', isTrigger: false },
  },
  {
    id: 'fragile-prop',
    label: 'Fragile prop',
    hint: 'Chunks into pieces on strong impact (needs the Fracture setup to be filled in).',
    patch: { enabled: true, bodyType: 'dynamic', collider: 'box', materialPreset: 'wood', mass: 2, friction: 0.6, restitution: 0.1, knockOverThreshold: 4 },
  },
  {
    id: 'trigger-zone',
    label: 'Trigger zone',
    hint: 'Detects overlaps (Trigger Enter/Exit in scripts) but doesn\u2019t block anything.',
    patch: { enabled: true, bodyType: 'fixed', collider: 'box', materialPreset: 'default', isTrigger: true, gravityScale: 0 },
  },
];

/** Apply a quick physics preset by id. Returns the (merged) physics component, or null if the id is unknown. */
export const applyPhysicsQuickPreset = (
  physics: PhysicsComponent,
  presetId: string,
): { physics: PhysicsComponent; preset: PhysicsQuickPreset } | null => {
  const preset = PHYSICS_QUICK_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  // Material presets carry ready-made friction/bounce/damping; apply first so an explicit override wins.
  let merged: PhysicsComponent = { ...physics };
  if (preset.patch.materialPreset) merged = applyPhysicsMaterialPreset(merged, preset.patch.materialPreset);
  merged = { ...merged, ...preset.patch };
  return { physics: merged, preset };
};
