import { MATERIAL_PRESETS, type MaterialPresetId } from '../three/presets';

export interface CreatorMaterialLook {
  id: string;
  label: string;
  presetId: MaterialPresetId;
}

/**
 * A deliberately small surface over the full material preset library. Creator
 * Mode never invents a second material format: every card resolves to one of
 * Feather's normal reusable material presets.
 */
export const CREATOR_MATERIAL_LOOKS: CreatorMaterialLook[] = [
  { id: 'soft', label: 'Soft', presetId: 'velvet' },
  { id: 'plastic', label: 'Plastic', presetId: 'plastic' },
  { id: 'metal', label: 'Metal', presetId: 'metal' },
  { id: 'glass', label: 'Glass', presetId: 'glass' },
  { id: 'glow', label: 'Glow', presetId: 'neon' },
  { id: 'toon', label: 'Toon', presetId: 'toon-flat' },
];

export const findCreatorMaterialPreset = (look: CreatorMaterialLook) =>
  MATERIAL_PRESETS.find((preset) => preset.id === look.presetId);
