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
