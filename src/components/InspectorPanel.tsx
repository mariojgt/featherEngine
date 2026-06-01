import { Link2, Settings2, Unlink } from 'lucide-react';
import { useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { MeshRendererComponent, PhysicsComponent, TransformComponent, Vector3Tuple } from '../types';

const axes = ['X', 'Y', 'Z'] as const;

const toDegrees = (value: number) => Math.round((value * 180) / Math.PI);
const toRadians = (value: number) => (value * Math.PI) / 180;

function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function VectorField({
  label,
  value,
  onChange,
  rotation,
}: {
  label: string;
  value: Vector3Tuple;
  onChange: (value: Vector3Tuple) => void;
  rotation?: boolean;
}) {
  const displayValue = rotation ? (value.map(toDegrees) as Vector3Tuple) : value;

  return (
    <label className="vector-field">
      <span>{label}</span>
      <div>
        {axes.map((axis, index) => (
          <span key={axis} className="axis-input">
            <em>{axis}</em>
            <NumberInput
              value={displayValue[index]}
              step={rotation ? 1 : 0.1}
              onChange={(nextValue) => {
                const next = [...displayValue] as Vector3Tuple;
                next[index] = nextValue;
                onChange(rotation ? (next.map(toRadians) as Vector3Tuple) : next);
              }}
            />
          </span>
        ))}
      </div>
    </label>
  );
}

function RangeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{value.toFixed(2)}</strong>
    </label>
  );
}

function RendererSection({
  renderer,
  onChange,
}: {
  renderer: MeshRendererComponent;
  onChange: (patch: Partial<MeshRendererComponent>) => void;
}) {
  return (
    <section className="inspector-section">
      <h3>Renderer</h3>
      <label className="field-row">
        <span>Mesh</span>
        <select value={renderer.mesh} onChange={(event) => onChange({ mesh: event.target.value as MeshRendererComponent['mesh'] })}>
          <option value="cube">Cube</option>
          <option value="sphere">Sphere</option>
          <option value="capsule">Capsule</option>
          <option value="plane">Plane</option>
        </select>
      </label>
      <label className="field-row">
        <span>Color</span>
        <input type="color" value={renderer.color} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <RangeField label="Metalness" value={renderer.metalness} onChange={(metalness) => onChange({ metalness })} />
      <RangeField label="Roughness" value={renderer.roughness} onChange={(roughness) => onChange({ roughness })} />
    </section>
  );
}

function PhysicsSection({
  physics,
  onChange,
}: {
  physics: PhysicsComponent;
  onChange: (patch: Partial<PhysicsComponent>) => void;
}) {
  return (
    <section className="inspector-section">
      <h3>Physics</h3>
      <label className="field-row">
        <span>Enabled</span>
        <input type="checkbox" checked={physics.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label className="field-row">
        <span>RigidBody</span>
        <select value={physics.bodyType} onChange={(event) => onChange({ bodyType: event.target.value as PhysicsComponent['bodyType'] })}>
          <option value="dynamic">Dynamic</option>
          <option value="fixed">Fixed</option>
          <option value="kinematic">Kinematic</option>
        </select>
      </label>
      <label className="field-row">
        <span>Collider</span>
        <select value={physics.collider} onChange={(event) => onChange({ collider: event.target.value as PhysicsComponent['collider'] })}>
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
          <option value="capsule">Capsule</option>
        </select>
      </label>
      <label className="field-row">
        <span>Mass</span>
        <NumberInput value={physics.mass} min={0} step={0.1} onChange={(mass) => onChange({ mass })} />
      </label>
      <label className="field-row">
        <span>Gravity</span>
        <NumberInput value={physics.gravityScale} step={0.1} onChange={(gravityScale) => onChange({ gravityScale })} />
      </label>
      <RangeField label="Friction" value={physics.friction} onChange={(friction) => onChange({ friction })} />
    </section>
  );
}

export function InspectorPanel() {
  const object = useEditorStore((state) => state.selectedObject());
  const renameObject = useEditorStore((state) => state.renameObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateRenderer = useEditorStore((state) => state.updateRenderer);
  const updatePhysics = useEditorStore((state) => state.updatePhysics);
  const togglePhysics = useEditorStore((state) => state.togglePhysics);
  const attachScript = useEditorStore((state) => state.attachScript);
  const detachScript = useEditorStore((state) => state.detachScript);
  const blueprints = useEditorStore((state) => state.blueprints);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);

  const transformValues = useMemo(
    () =>
      object
        ? (Object.keys(object.transform) as Array<keyof TransformComponent>).map((field) => ({
            field,
            label: field[0].toUpperCase() + field.slice(1),
            value: object.transform[field],
          }))
        : [],
    [object],
  );

  return (
    <aside className="panel inspector-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Object</span>
          <h2>Inspector</h2>
        </div>
        <Settings2 size={18} aria-hidden />
      </div>

      {!object ? (
        <div className="empty-state">No object selected</div>
      ) : (
        <div className="inspector-content">
          <section className="inspector-section title-section">
            <input className="name-input" value={object.name} onChange={(event) => renameObject(object.id, event.target.value)} />
            <span className="kind-label">{object.kind}</span>
          </section>

          <section className="inspector-section">
            <h3>Transform</h3>
            {transformValues.map(({ field, label, value }) => (
              <VectorField
                key={field}
                label={label}
                value={value}
                rotation={field === 'rotation'}
                onChange={(nextValue) => updateTransform(object.id, field, nextValue)}
              />
            ))}
          </section>

          {object.renderer && (
            <RendererSection renderer={object.renderer} onChange={(patch) => updateRenderer(object.id, patch)} />
          )}

          {object.physics ? (
            <PhysicsSection physics={object.physics} onChange={(patch) => updatePhysics(object.id, patch)} />
          ) : (
            <section className="inspector-section">
              <h3>Physics</h3>
              <button className="full-button" onClick={() => togglePhysics(object.id)}>
                Add RigidBody
              </button>
            </section>
          )}

          <section className="inspector-section">
            <h3>Scripts</h3>
            <label className="field-row">
              <span>Blueprint</span>
              <select
                value={object.script?.blueprintId ?? ''}
                onChange={(event) => {
                  if (!event.target.value) {
                    detachScript(object.id);
                    return;
                  }

                  attachScript(object.id, event.target.value);
                }}
              >
                <option value="">None</option>
                {blueprints.map((blueprint) => (
                  <option key={blueprint.id} value={blueprint.id}>
                    {blueprint.name}
                  </option>
                ))}
              </select>
            </label>
            {object.script && (
              <div className="script-card">
                <div>
                  <Link2 size={14} aria-hidden />
                  <span>{blueprints.find((blueprint) => blueprint.id === object.script?.blueprintId)?.name}</span>
                </div>
                <p>Reusable Blueprint instance attached to this object.</p>
                <div className="script-actions">
                  <button onClick={() => setActiveBlueprint(object.script!.blueprintId)}>Edit</button>
                  <button onClick={() => detachScript(object.id)}>
                    <Unlink size={13} aria-hidden />
                    Detach
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
