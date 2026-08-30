import { Palette } from 'lucide-react';
import { CREATOR_MATERIAL_LOOKS, findCreatorMaterialPreset } from '../materialLooks';
import { materialPresetPatch } from '../../three/presets';
import { useEditorStore } from '../../store/editorStore';
import type { MaterialDefinition, SceneObject } from '../../types';
import { focusWorkspacePanel } from '../../components/workspacePanels';

const COLOR_SWATCHES = ['#5B8CFF', '#F05F78', '#FFD45A', '#6ED7A6', '#A978FF', '#F5F1E8'];

export function CreatorAppearanceSection({ object }: { object: SceneObject }) {
  const createMaterial = useEditorStore((state) => state.createMaterial);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const setObjectMaterial = useEditorStore((state) => state.setObjectMaterial);
  const setObjectMaterialSlot = useEditorStore((state) => state.setObjectMaterialSlot);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const materials = useEditorStore((state) => state.materials);
  const renderer = object.renderer;
  if (!renderer) return null;

  const marker = `Creator look for ${object.id}`;
  const assignedIds = [renderer.materialId, ...(renderer.materialSlots ?? [])].filter(Boolean) as string[];
  const assignedMaterial = assignedIds
    .map((id) => materials.find((material) => material.id === id))
    .find((material) => material?.description.startsWith(marker));
  const activeLookId = assignedMaterial?.description.split(' · ')[1];

  const assignAcrossObject = (materialId: string) => {
    setObjectMaterial(object.id, materialId);
    if (!renderer.modelAssetId) return;
    const importedSlots = materials.filter((material) => material.sourceAssetId === renderer.modelAssetId).length;
    const slotCount = Math.max(importedSlots, renderer.materialSlots?.length ?? 0);
    for (let index = 0; index < slotCount; index += 1) setObjectMaterialSlot(object.id, index, materialId);
  };

  const ensureCreatorMaterial = (): string => {
    if (assignedMaterial) return assignedMaterial.id;

    const source = renderer.materialId
      ? materials.find((material) => material.id === renderer.materialId)
      : renderer.modelAssetId
        ? materials.find((material) => material.sourceAssetId === renderer.modelAssetId)
        : undefined;
    const materialId = createMaterial(`${object.name} Look`, marker);
    const base: Partial<MaterialDefinition> = source
      ? {
          color: source.color,
          metalness: source.metalness,
          roughness: source.roughness,
          emissiveColor: source.emissiveColor,
          emissiveIntensity: source.emissiveIntensity,
          textureAssetId: source.textureAssetId,
          normalMapAssetId: source.normalMapAssetId,
        }
      : {
          color: renderer.color,
          metalness: renderer.metalness,
          roughness: renderer.roughness,
          emissiveColor: '#000000',
          emissiveIntensity: 0,
          textureAssetId: renderer.textureAssetId,
        };
    updateMaterial(materialId, { ...base, description: marker });
    assignAcrossObject(materialId);
    return materialId;
  };

  const applyLook = (look: (typeof CREATOR_MATERIAL_LOOKS)[number]) => {
    const preset = findCreatorMaterialPreset(look);
    if (!preset) return;
    const materialId = ensureCreatorMaterial();
    updateMaterial(materialId, {
      ...materialPresetPatch(preset),
      name: `${object.name} · ${look.label}`,
      description: `${marker} · ${look.id}`,
    });
  };

  const applyColor = (color: string) => {
    const materialId = ensureCreatorMaterial();
    const material = useEditorStore.getState().materials.find((item) => item.id === materialId);
    updateMaterial(materialId, {
      color,
      ...(material && material.emissiveIntensity > 0 ? { emissiveColor: color } : {}),
    });
  };

  const currentColor = assignedMaterial?.color ?? renderer.color;

  return (
    <section className="inspector-section creator-inspector-section creator-appearance-section">
      <div className="creator-section-heading compact">
        <h3>Appearance</h3>
        <Palette size={14} aria-hidden />
      </div>

      <div className="creator-look-grid">
        {CREATOR_MATERIAL_LOOKS.map((look) => (
          <button
            type="button"
            key={look.id}
            className={activeLookId === look.id ? 'creator-look-card active' : 'creator-look-card'}
            aria-pressed={activeLookId === look.id}
            onClick={() => applyLook(look)}
          >
            <span className={`creator-look-preview look-${look.id}`} aria-hidden />
            <span>{look.label}</span>
          </button>
        ))}
      </div>

      <div className="creator-color-row">
        <span>Color</span>
        <div className="creator-color-swatches">
          {COLOR_SWATCHES.map((color) => (
            <button
              type="button"
              key={color}
              className={currentColor.toLowerCase() === color.toLowerCase() ? 'active' : ''}
              style={{ background: color }}
              aria-label={`Use color ${color}`}
              aria-pressed={currentColor.toLowerCase() === color.toLowerCase()}
              onClick={() => applyColor(color)}
            />
          ))}
          <label className="creator-custom-color" title="Choose a custom color">
            <span aria-hidden>＋</span>
            <input type="color" value={currentColor} onChange={(event) => applyColor(event.target.value)} />
          </label>
        </div>
      </div>

      <button
        type="button"
        className="creator-material-advanced"
        onClick={() => {
          const importedMaterialId = renderer.modelAssetId
            ? materials.find((material) => material.sourceAssetId === renderer.modelAssetId)?.id
            : undefined;
          const materialId = renderer.materialId
            ?? renderer.materialSlots?.find((id): id is string => Boolean(id))
            ?? importedMaterialId
            ?? ensureCreatorMaterial();
          setActiveMaterial(materialId);
          focusWorkspacePanel('materials');
        }}
      >
        Advanced Material Settings
      </button>
    </section>
  );
}
