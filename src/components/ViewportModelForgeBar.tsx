import { Box, Cone, Copy, Cylinder, Globe, Hammer, Paintbrush, Pyramid, RotateCcw, Trash2 } from 'lucide-react';
import type { ModelPartShape, SceneObject } from '../types';
import { openModelForgeStudio } from '../extensions/openModelForge';
import { DEFAULT_MODEL_STYLE } from '../model/modelSpec';
import { useEditorStore } from '../store/editorStore';
import { MODEL_FORGE_SHAPES, useModelForgeSession } from '../store/modelForgeSessionStore';

const SHAPE_ICON: Record<ModelPartShape, typeof Box> = {
  box: Box,
  cylinder: Cylinder,
  sphere: Globe,
  cone: Cone,
  wedge: Pyramid,
};

function addPartBeside(specId: string, shape: ModelPartShape, besideId: string) {
  const store = useEditorStore.getState();
  const spec = store.modelSpecs.find((entry) => entry.id === specId);
  const beside = spec?.parts.find((part) => part.id === besideId);
  const offset: [number, number, number] = beside
    ? [beside.position[0] + Math.max(beside.scale[0], 0.6), beside.position[1], beside.position[2]]
    : [0, 0.5, 0];
  const partId = store.addModelPart(specId, shape, { position: offset });
  if (partId) useModelForgeSession.getState().setPartId(partId);
}

export function ViewportModelForgeBar({ object }: { object: SceneObject }) {
  const specId = object.model?.specId;
  const spec = useEditorStore((state) =>
    specId ? state.modelSpecs.find((entry) => entry.id === specId) : undefined,
  ) ?? object.model?.spec;
  const mode = useModelForgeSession((state) => state.mode);
  const setMode = useModelForgeSession((state) => state.setMode);
  const partId = useModelForgeSession((state) => state.partId);
  const setPartId = useModelForgeSession((state) => state.setPartId);
  const colorSlot = useModelForgeSession((state) => state.colorSlot);
  const setColorSlot = useModelForgeSession((state) => state.setColorSlot);
  const gizmoMode = useModelForgeSession((state) => state.gizmoMode);

  if (!specId || !spec) return null;

  const store = () => useEditorStore.getState();
  const style = spec.style ?? DEFAULT_MODEL_STYLE;
  const selectedPart = spec.parts.find((part) => part.id === partId);
  const editingPart = mode === 'build' && Boolean(selectedPart);

  return (
    <div className="model-forge-bar" onMouseDown={(event) => event.stopPropagation()}>
      <div className="model-forge-bar-row">
        <span className="model-forge-bar-title">Model Forge</span>
        <span className={`model-forge-scope ${editingPart ? 'is-part' : 'is-prop'}`}>
          {editingPart ? `Part · ${selectedPart?.name || selectedPart?.shape}` : 'Whole prop'}
        </span>
        <div className="model-toolbar-seg" role="tablist" aria-label="Model Forge mode">
          <button type="button" className={mode === 'build' ? 'active' : undefined} onClick={() => setMode('build')}>
            <Hammer size={12} aria-hidden /> Object
          </button>
          <button type="button" className={mode === 'paint' ? 'active' : undefined} onClick={() => setMode('paint')}>
            <Paintbrush size={12} aria-hidden /> Paint
          </button>
          <button
            type="button"
            className={mode === 'mesh' ? 'active' : undefined}
            title="Edit box vertices, edges, and faces in the Model Forge studio"
            onClick={() => {
              setMode('mesh');
              store().setActiveModelSpec(specId);
              openModelForgeStudio();
            }}
          >
            Edit
          </button>
        </div>
        <button
          type="button"
          className="model-forge-studio-btn"
          onClick={() => {
            store().setActiveModelSpec(specId);
            openModelForgeStudio();
          }}
        >
          Open studio
        </button>
      </div>

      <div className="model-part-chips model-forge-bar-chips" role="listbox" aria-label="Parts">
        {spec.parts.map((part) => (
          <button
            key={part.id}
            type="button"
            role="option"
            aria-selected={part.id === partId}
            className={part.id === partId ? 'active' : undefined}
            onClick={() => {
              setPartId(part.id);
              if (mode !== 'paint') setMode('build');
            }}
          >
            <span className="model-part-chip-swatch" style={{ background: spec.palette[part.colorSlot] ?? '#888' }} />
            {part.name || part.shape}
          </button>
        ))}
      </div>

      {mode === 'build' && (
        <div className="model-forge-bar-row">
          <span className="model-forge-bar-hint">
            {editingPart
              ? `Drag gizmo (${gizmoMode === 'translate' ? 'W move' : gizmoMode === 'rotate' ? 'E rotate' : 'R scale'}). Esc → whole prop.`
              : 'Pick a part chip or click the mesh, then drag W/E/R.'}
          </span>
          <div className="model-shape-row">
            {MODEL_FORGE_SHAPES.map(({ shape, label }) => {
              const Icon = SHAPE_ICON[shape];
              return (
                <button key={shape} type="button" title={`Add ${label}`} onClick={() => addPartBeside(specId, shape, partId)}>
                  <Icon size={14} aria-hidden />
                </button>
              );
            })}
          </div>
          {selectedPart && (
            <div className="model-part-actions">
              <button
                type="button"
                title="Duplicate part"
                onClick={() => {
                  const copyId = store().duplicateModelPart(specId, selectedPart.id);
                  if (copyId) setPartId(copyId);
                }}
              >
                <Copy size={12} aria-hidden /> Duplicate
              </button>
              <button
                type="button"
                className="danger-soft"
                title="Delete part"
                disabled={spec.parts.length <= 1}
                onClick={() => {
                  store().removeModelPart(specId, selectedPart.id);
                  setPartId('');
                }}
              >
                <Trash2 size={12} aria-hidden /> Delete
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'build' && selectedPart && (
        <div className="model-forge-bar-row model-forge-part-xform">
          <label>
            Size
            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
              <input
                key={axis}
                type="number"
                step={0.1}
                min={0.05}
                aria-label={`Size ${axis}`}
                value={Number(selectedPart.scale[index].toFixed(3))}
                onChange={(event) => {
                  const next = [...selectedPart.scale] as [number, number, number];
                  next[index] = Math.max(0.05, Number(event.target.value) || 0.05);
                  store().updateModelPart(specId, selectedPart.id, { scale: next });
                }}
              />
            ))}
          </label>
          <label>
            Offset
            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
              <input
                key={axis}
                type="number"
                step={0.1}
                aria-label={`Offset ${axis}`}
                value={Number(selectedPart.position[index].toFixed(3))}
                onChange={(event) => {
                  const next = [...selectedPart.position] as [number, number, number];
                  next[index] = Number(event.target.value) || 0;
                  store().updateModelPart(specId, selectedPart.id, { position: next });
                }}
              />
            ))}
          </label>
        </div>
      )}

      {mode === 'paint' && (
        <div className="model-forge-bar-row">
          <span className="model-forge-bar-hint">Click a face to paint.</span>
          <div className="model-forge-palette">
            {spec.palette.map((color, slot) => (
              <button
                key={`${color}-${slot}`}
                type="button"
                className={slot === colorSlot ? 'active' : undefined}
                style={{ background: color }}
                title={`Palette ${slot}`}
                onClick={() => setColorSlot(slot)}
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'mesh' && (
        <p className="model-forge-bar-hint">
          Edit opens the studio — select and transform box vertices, edges, or faces. Soft bevel stays live.
        </p>
      )}

      <div className="model-forge-bar-row">
        <div className="model-toolbar-seg" role="tablist" aria-label="Finish">
          <button
            type="button"
            className={style.finish === 'smooth' ? 'active' : undefined}
            onClick={() => store().updateModelSpec(specId, { style: { ...style, finish: 'smooth' } })}
          >
            Smooth
          </button>
          <button
            type="button"
            className={style.finish === 'flat' ? 'active' : undefined}
            onClick={() => store().updateModelSpec(specId, { style: { ...style, finish: 'flat' } })}
          >
            Flat
          </button>
        </div>
        {selectedPart?.corners && (
          <button type="button" onClick={() => store().setModelPartCorners(specId, selectedPart.id, null)}>
            <RotateCcw size={12} aria-hidden /> Reset vertices
          </button>
        )}
      </div>
    </div>
  );
}
