import { useEditorStore } from '../../store/editorStore';
import { CHARACTER_MOVEMENT_PRESETS } from '../../runtime/characterPresets';
import { PHYSICS_MATERIAL_PRESETS, applyPhysicsMaterialPreset } from '../../runtime/physicsMaterials';
import type { CharacterControllerComponent, PhysicsMaterialPresetId, SceneObject } from '../../types';

const FIELDS: { key: keyof CharacterControllerComponent; label: string; unit: string; min: number; max: number; fallback: number }[] = [
  { key: 'moveSpeed', label: 'Move speed', unit: 'm/s', min: 0.1, max: 30, fallback: 5 },
  { key: 'jumpStrength', label: 'Jump strength', unit: 'm/s', min: 0, max: 30, fallback: 8 },
  { key: 'coyoteTime', label: 'Ledge jump grace', unit: 'seconds', min: 0, max: 0.5, fallback: 0.12 },
  { key: 'jumpBufferTime', label: 'Early jump grace', unit: 'seconds', min: 0, max: 0.5, fallback: 0.15 },
  { key: 'stepHeight', label: 'Step height', unit: 'meters', min: 0, max: 2, fallback: 0.4 },
  { key: 'groundSnap', label: 'Follow ground', unit: 'meters', min: 0, max: 2, fallback: 0.4 },
  { key: 'maxSlopeDegrees', label: 'Climb slopes up to', unit: 'degrees', min: 0, max: 89, fallback: 45 },
];

export function CreatorMovementControls({ object }: { object: SceneObject }) {
  const updateCharacter = useEditorStore((state) => state.updateCharacterController);
  const updatePhysics = useEditorStore((state) => state.updatePhysics);
  const current = CHARACTER_MOVEMENT_PRESETS.find((preset) => Object.entries(preset.patch).every(([key, value]) => object.character?.[key as keyof CharacterControllerComponent] === value));
  return <>
    {object.character?.enabled && <div className="creator-gameplay-fields">
      <label className="creator-gameplay-field"><span><strong>Movement feel</strong><small>Reapply a preset to reset these settings.</small></span><select aria-label="Movement feel" value={current?.id ?? ''} onChange={(event) => {
        const preset = CHARACTER_MOVEMENT_PRESETS.find((item) => item.id === event.target.value);
        if (preset) updateCharacter(object.id, preset.patch);
      }}><option value="" disabled>Custom settings</option>{CHARACTER_MOVEMENT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      {current && <p className="creator-empty-copy">{current.description}</p>}
      {FIELDS.map((field) => <label className="creator-gameplay-field" key={field.key}><span><strong>{field.label}</strong></span><span className="creator-gameplay-control"><input type="number" aria-label={field.label} min={field.min} max={field.max} step={field.max <= 2 ? 0.01 : 0.1} value={Number(object.character?.[field.key] ?? field.fallback)} onChange={(event) => {
        const value = event.target.valueAsNumber;
        if (Number.isFinite(value)) updateCharacter(object.id, { [field.key]: Math.min(field.max, Math.max(field.min, value)) });
      }} /><small className="creator-field-unit">{field.unit}</small></span></label>)}
      <p className="creator-empty-copy">Ledge grace allows a jump just after leaving an edge. Early grace remembers a jump pressed just before landing. Set step height or follow ground to 0 to disable it.</p>
    </div>}
    {object.physics?.enabled && !object.character?.enabled && <label className="creator-gameplay-field"><span><strong>Physical surface</strong><small>Grip and bounce for physical objects.</small></span><select aria-label="Physical surface" value={object.physics.materialPreset ?? 'default'} onChange={(event) => updatePhysics(object.id, applyPhysicsMaterialPreset(object.physics!, event.target.value as PhysicsMaterialPresetId))}>{PHYSICS_MATERIAL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>}
  </>;
}
