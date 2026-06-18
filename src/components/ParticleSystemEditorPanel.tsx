import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Plus, Sparkles } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { ParticleSystem } from '../three/ParticleSystem';
import { particlePresetIds, particlePresets, particleAssetConfig } from '../runtime/particlePresets';
import { RangeField } from './InspectorPanel';
import type { AssetItem, ParticleEmitterShape, ParticleSystemComponent, ParticleSystemDefinition, SceneObject } from '../types';

/** A live emitter preview — a dummy object that references the asset, so it updates as you edit. */
function ParticlePreview({ system }: { system: ParticleSystemDefinition }) {
  const previewObject: SceneObject = {
    id: `preview-${system.id}`,
    name: system.name,
    kind: 'empty',
    transform: { position: [0, -0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    particles: { ...particleAssetConfig(system), enabled: true, systemId: system.id } as ParticleSystemComponent,
  };
  return (
    <group>
      <ParticleSystem object={previewObject} />
    </group>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isInteger(value) ? value : Number(value.toFixed(3))}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ParticleControls({ system }: { system: ParticleSystemDefinition }) {
  const updateParticleSystem = useEditorStore((state) => state.updateParticleSystem);
  const assets = useEditorStore((state) => state.assets);
  const imageAssets = assets.filter((asset) => asset.type === 'image') as AssetItem[];
  const set = (patch: Partial<ParticleSystemDefinition>) => updateParticleSystem(system.id, patch);

  return (
    <aside className="graph-inspector">
      <div className="graph-inspector-header">
        <span className="eyebrow">Particle System</span>
        <h3>{system.name}</h3>
      </div>
      <div className="node-inspector-body">
        <label className="node-field">
          <span>Preset</span>
          <select
            defaultValue=""
            onChange={(event) => {
              const preset = event.target.value as keyof typeof particlePresets;
              // Re-seed the config fields from the preset, keeping the asset's identity.
              if (preset && particlePresets[preset]) set(particlePresets[preset]);
            }}
          >
            <option value="">Re-seed from preset…</option>
            {particlePresetIds.map((preset) => (
              <option key={preset} value={preset}>
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="node-field">
          <span>Looping</span>
          <input type="checkbox" checked={system.looping} onChange={(event) => set({ looping: event.target.checked })} />
        </label>
        {system.looping ? (
          <NumberField label="Rate /s" value={system.rate} min={0} step={1} onChange={(rate) => set({ rate })} />
        ) : (
          <NumberField label="Burst" value={system.burst} min={0} step={1} onChange={(burst) => set({ burst })} />
        )}
        <NumberField label="Max" value={system.maxParticles} min={1} max={4000} step={10} onChange={(maxParticles) => set({ maxParticles })} />

        <label className="node-field">
          <span>Shape</span>
          <select value={system.shape} onChange={(event) => set({ shape: event.target.value as ParticleEmitterShape })}>
            <option value="point">Point</option>
            <option value="cone">Cone</option>
            <option value="disc">Disc</option>
            <option value="sphere">Sphere</option>
            <option value="hemisphere">Hemisphere</option>
            <option value="box">Box</option>
          </select>
        </label>
        <NumberField label="Radius" value={system.shapeRadius} min={0} step={0.05} onChange={(shapeRadius) => set({ shapeRadius })} />
        <NumberField label="Spread °" value={system.coneAngle} min={0} max={180} step={1} onChange={(coneAngle) => set({ coneAngle })} />

        <div className="node-field">
          <span>Direction</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {([0, 1, 2] as const).map((axis) => (
              <input
                key={axis}
                type="number"
                step={0.1}
                value={system.direction[axis]}
                onChange={(event) => {
                  const next = [...system.direction] as [number, number, number];
                  next[axis] = Number(event.target.value);
                  set({ direction: next });
                }}
              />
            ))}
          </div>
        </div>

        <NumberField label="Speed" value={system.speed} step={0.1} onChange={(speed) => set({ speed })} />
        <RangeField label="Speed Jitter" value={system.speedJitter} onChange={(speedJitter) => set({ speedJitter })} />
        <NumberField label="Gravity" value={system.gravity} step={0.1} onChange={(gravity) => set({ gravity })} />
        <RangeField label="Drag" value={system.drag} max={3} onChange={(drag) => set({ drag })} />
        <NumberField label="Lifetime" value={system.lifetime} min={0.05} step={0.1} onChange={(lifetime) => set({ lifetime })} />
        <RangeField label="Life Jitter" value={system.lifetimeJitter} onChange={(lifetimeJitter) => set({ lifetimeJitter })} />

        <NumberField label="Start Size" value={system.startSize} min={0} step={0.02} onChange={(startSize) => set({ startSize })} />
        <NumberField label="End Size" value={system.endSize} min={0} step={0.02} onChange={(endSize) => set({ endSize })} />
        <label className="node-field">
          <span>Start Color</span>
          <input type="color" value={system.startColor} onChange={(event) => set({ startColor: event.target.value })} />
        </label>
        <label className="node-field">
          <span>End Color</span>
          <input type="color" value={system.endColor} onChange={(event) => set({ endColor: event.target.value })} />
        </label>
        <RangeField label="Start Opacity" value={system.startOpacity} onChange={(startOpacity) => set({ startOpacity })} />
        <RangeField label="End Opacity" value={system.endOpacity} onChange={(endOpacity) => set({ endOpacity })} />

        <label className="node-field">
          <span>Blend</span>
          <select value={system.blend} onChange={(event) => set({ blend: event.target.value as ParticleSystemDefinition['blend'] })}>
            <option value="additive">Additive (glow)</option>
            <option value="normal">Normal (smoke)</option>
          </select>
        </label>
        <label className="node-field">
          <span>World Space</span>
          <input type="checkbox" checked={system.worldSpace} onChange={(event) => set({ worldSpace: event.target.checked })} />
        </label>
        <label className="node-field">
          <span>Emit Light</span>
          <input type="checkbox" checked={system.light ?? false} onChange={(event) => set({ light: event.target.checked })} />
        </label>
        <label className="node-field">
          <span>Sprite</span>
          <select value={system.textureAssetId ?? ''} onChange={(event) => set({ textureAssetId: event.target.value || undefined })}>
            <option value="">Soft dot</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}

export function ParticleSystemEditorPanel() {
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const activeParticleSystemId = useEditorStore((state) => state.activeParticleSystemId);
  const setActiveParticleSystem = useEditorStore((state) => state.setActiveParticleSystem);
  const createParticleSystem = useEditorStore((state) => state.createParticleSystem);

  const system = particleSystems.find((item) => item.id === activeParticleSystemId) ?? particleSystems[0];

  return (
    <section className="panel material-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Effect</span>
          <h2>Particle System</h2>
        </div>
        {particleSystems.length > 0 && (
          <select
            className="blueprint-select"
            value={system?.id ?? ''}
            onChange={(event) => setActiveParticleSystem(event.target.value)}
            title="Select particle system"
          >
            {particleSystems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create particle system" onClick={() => createParticleSystem(undefined, 'fire')}>
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {!system ? (
        <div className="empty-state wide">
          <Sparkles size={18} aria-hidden />
          <span>No particle system yet</span>
          <button className="full-button" onClick={() => createParticleSystem(undefined, 'fire')}>
            Create Particle System
          </button>
        </div>
      ) : (
        <>
          <div className="material-preview">
            <Canvas shadows camera={{ position: [0, 0.4, 4], fov: 42 }}>
              <color attach="background" args={['#0b0d13']} />
              <ambientLight intensity={0.4} />
              <directionalLight position={[3, 4, 2]} intensity={0.8} />
              <Environment resolution={128}>
                <Lightformer intensity={0.8} position={[0, 4, 0]} scale={[8, 8, 1]} />
              </Environment>
              <Suspense fallback={null}>
                <ParticlePreview system={system} />
              </Suspense>
              <OrbitControls enablePan={false} enableDamping dampingFactor={0.08} minDistance={2} maxDistance={9} />
            </Canvas>
          </div>
          <div className="scripting-body">
            <ParticleControls system={system} />
          </div>
        </>
      )}
    </section>
  );
}
