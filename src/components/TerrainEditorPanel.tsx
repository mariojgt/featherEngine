import { useEffect, useMemo, useState } from 'react';
import { Brush, Eraser, Mountain, Palette, Plus, Settings2, Sprout, Trash2 } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { RangeField } from './InspectorPanel';
import { withTerrainDefaults } from '../terrain/terrain';
import type { AssetItem, TerrainBrushMode, TerrainComponent, TerrainSculptOperation } from '../types';

type TerrainTab = 'sculpt' | 'paint' | 'foliage' | 'settings';

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  precision = 2,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
}) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isInteger(value) ? value : Number(value.toFixed(precision))}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function AssetSelect({
  label,
  value,
  assets,
  emptyLabel,
  onChange,
}: {
  label: string;
  value?: string;
  assets: AssetItem[];
  emptyLabel: string;
  onChange: (assetId?: string) => void;
}) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">{emptyLabel}</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function TerrainSettings({ objectId, terrain }: { objectId: string; terrain: TerrainComponent }) {
  const updateTerrain = useEditorStore((state) => state.updateTerrain);
  const set = (patch: Partial<TerrainComponent>) => updateTerrain(objectId, patch);
  return (
    <div className="terrain-control-grid">
      <label className="node-field row">
        <span>Enabled</span>
        <input type="checkbox" checked={terrain.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
      </label>
      <NumberField label="Size" value={terrain.size} min={32} step={32} onChange={(size) => set({ size })} />
      <NumberField label="Chunk" value={terrain.chunkSize} min={8} step={8} onChange={(chunkSize) => set({ chunkSize })} />
      <NumberField label="Resolution" value={terrain.resolution} min={4} max={64} step={1} onChange={(resolution) => set({ resolution })} />
      <NumberField label="Edit Spacing" value={terrain.editSpacing} min={0.5} max={16} step={0.25} onChange={(editSpacing) => set({ editSpacing })} />
      <NumberField label="Stream Radius" value={terrain.streamRadius} min={1} max={10} step={1} onChange={(streamRadius) => set({ streamRadius })} />
      <NumberField label="Physics Radius" value={terrain.physicsRadius} min={1} max={5} step={1} onChange={(physicsRadius) => set({ physicsRadius })} />
      <NumberField label="Seed" value={terrain.seed} step={1} precision={0} onChange={(seed) => set({ seed })} />
      <NumberField label="Height" value={terrain.heightScale} min={0} step={0.5} onChange={(heightScale) => set({ heightScale })} />
      <NumberField label="Frequency" value={terrain.frequency} min={0.001} max={0.25} step={0.001} precision={4} onChange={(frequency) => set({ frequency })} />
      <NumberField label="Octaves" value={terrain.octaves} min={1} max={8} step={1} onChange={(octaves) => set({ octaves })} />
      <NumberField label="Persistence" value={terrain.persistence} min={0.05} max={0.95} step={0.05} onChange={(persistence) => set({ persistence })} />
      <NumberField label="Lacunarity" value={terrain.lacunarity} min={1.1} max={4} step={0.1} onChange={(lacunarity) => set({ lacunarity })} />
    </div>
  );
}

function SculptControls({ objectId }: { objectId: string }) {
  const brush = useEditorStore((state) => state.terrainBrush);
  const setTerrainBrush = useEditorStore((state) => state.setTerrainBrush);
  const clearTerrainEdits = useEditorStore((state) => state.clearTerrainEdits);
  const setBrush = (patch: Partial<typeof brush>) => setTerrainBrush({ ...patch, mode: 'sculpt' });
  return (
    <div className="terrain-control-grid">
      <label className="node-field">
        <span>Operation</span>
        <select value={brush.operation} onChange={(event) => setBrush({ operation: event.target.value as TerrainSculptOperation })}>
          <option value="raise">Raise</option>
          <option value="lower">Lower</option>
          <option value="flatten">Flatten</option>
          <option value="smooth">Smooth</option>
        </select>
      </label>
      <NumberField label="Radius" value={brush.radius} min={0.5} step={0.5} onChange={(radius) => setBrush({ radius })} />
      <NumberField label="Strength" value={brush.strength} min={0} step={0.05} onChange={(strength) => setBrush({ strength })} />
      <NumberField label="Flatten Height" value={brush.flattenHeight} step={0.25} onChange={(flattenHeight) => setBrush({ flattenHeight })} />
      <button className="full-button danger-soft" onClick={() => clearTerrainEdits(objectId, 'height')}>
        <Eraser size={14} aria-hidden />
        Clear Sculpt
      </button>
    </div>
  );
}

function PaintControls({
  objectId,
  terrain,
  imageAssets,
}: {
  objectId: string;
  terrain: TerrainComponent;
  imageAssets: AssetItem[];
}) {
  const brush = useEditorStore((state) => state.terrainBrush);
  const setTerrainBrush = useEditorStore((state) => state.setTerrainBrush);
  const updateLayer = useEditorStore((state) => state.updateTerrainMaterialLayer);
  const addLayer = useEditorStore((state) => state.addTerrainMaterialLayer);
  const removeLayer = useEditorStore((state) => state.removeTerrainMaterialLayer);
  const clearTerrainEdits = useEditorStore((state) => state.clearTerrainEdits);
  const activeLayerId = brush.targetLayerId && terrain.materialLayers.some((layer) => layer.id === brush.targetLayerId)
    ? brush.targetLayerId
    : terrain.materialLayers[0]?.id;

  return (
    <div className="terrain-paint-layout">
      <div className="terrain-layer-list">
        {terrain.materialLayers.map((layer) => (
          <button
            key={layer.id}
            className={layer.id === activeLayerId ? 'active' : ''}
            onClick={() => setTerrainBrush({ mode: 'paint', targetLayerId: layer.id })}
            title={layer.name}
          >
            <span className="terrain-swatch" style={{ background: layer.color }} />
            <span>{layer.name}</span>
          </button>
        ))}
      </div>
      {terrain.materialLayers.map((layer) =>
        layer.id === activeLayerId ? (
          <div key={layer.id} className="terrain-control-grid">
            <label className="node-field">
              <span>Name</span>
              <input value={layer.name} onChange={(event) => updateLayer(objectId, layer.id, { name: event.target.value })} />
            </label>
            <label className="node-field">
              <span>Color</span>
              <input type="color" value={layer.color} onChange={(event) => updateLayer(objectId, layer.id, { color: event.target.value })} />
            </label>
            <AssetSelect
              label="Base Texture"
              value={layer.textureAssetId}
              assets={imageAssets}
              emptyLabel="None"
              onChange={(textureAssetId) => updateLayer(objectId, layer.id, { textureAssetId })}
            />
            <AssetSelect
              label="Normal Map"
              value={layer.normalMapAssetId}
              assets={imageAssets}
              emptyLabel="None"
              onChange={(normalMapAssetId) => updateLayer(objectId, layer.id, { normalMapAssetId })}
            />
            <NumberField label="Brush Radius" value={brush.radius} min={0.5} step={0.5} onChange={(radius) => setTerrainBrush({ mode: 'paint', radius })} />
            <div className="terrain-button-row">
              <button
                className="icon-button compact"
                title="Add layer"
                onClick={() => {
                  const id = addLayer(objectId);
                  if (id) setTerrainBrush({ mode: 'paint', targetLayerId: id });
                }}
              >
                <Plus size={14} aria-hidden />
              </button>
              <button className="icon-button compact" title="Remove layer" onClick={() => removeLayer(objectId, layer.id)}>
                <Trash2 size={14} aria-hidden />
              </button>
              <button className="full-button danger-soft" onClick={() => clearTerrainEdits(objectId, 'paint')}>
                <Eraser size={14} aria-hidden />
                Clear Paint
              </button>
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function FoliageControls({
  objectId,
  terrain,
  modelAssets,
}: {
  objectId: string;
  terrain: TerrainComponent;
  modelAssets: AssetItem[];
}) {
  const updateTerrain = useEditorStore((state) => state.updateTerrain);
  const foliage = terrain.foliage;
  const setFoliage = (patch: Partial<TerrainComponent['foliage']>) => updateTerrain(objectId, { foliage: { ...foliage, ...patch } });
  return (
    <div className="terrain-control-grid">
      <label className="node-field row">
        <span>Enabled</span>
        <input type="checkbox" checked={foliage.enabled} onChange={(event) => setFoliage({ enabled: event.target.checked })} />
      </label>
      <label className="node-field">
        <span>Mode</span>
        <select value={foliage.mode} onChange={(event) => setFoliage({ mode: event.target.value as TerrainComponent['foliage']['mode'] })}>
          <option value="grass">Grass</option>
          <option value="trees">Trees</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <label className="node-field">
        <span>Grass Mesh</span>
        <select value={foliage.grassMesh} onChange={(event) => setFoliage({ grassMesh: event.target.value as TerrainComponent['foliage']['grassMesh'] })}>
          <option value="blade">Blade</option>
          <option value="cross">Cross</option>
          <option value="tuft">Tuft</option>
        </select>
      </label>
      <label className="node-field">
        <span>Tree Mesh</span>
        <select value={foliage.treeMesh} onChange={(event) => setFoliage({ treeMesh: event.target.value as TerrainComponent['foliage']['treeMesh'] })}>
          <option value="cone">Cone</option>
          <option value="round">Round</option>
        </select>
      </label>
      <AssetSelect label="Grass Model" value={foliage.grassModelAssetId} assets={modelAssets} emptyLabel="Built-in" onChange={(grassModelAssetId) => setFoliage({ grassModelAssetId })} />
      <AssetSelect label="Tree Model" value={foliage.treeModelAssetId} assets={modelAssets} emptyLabel="Built-in" onChange={(treeModelAssetId) => setFoliage({ treeModelAssetId })} />
      <RangeField label="Grass Density" value={foliage.density} onChange={(density) => setFoliage({ density })} />
      <RangeField label="Tree Density" value={foliage.treeDensity} onChange={(treeDensity) => setFoliage({ treeDensity })} />
      <RangeField label="Slope Limit" value={foliage.slopeLimit} onChange={(slopeLimit) => setFoliage({ slopeLimit })} />
      <NumberField label="Min Scale" value={foliage.minScale} min={0.1} step={0.1} onChange={(minScale) => setFoliage({ minScale })} />
      <NumberField label="Max Scale" value={foliage.maxScale} min={0.1} step={0.1} onChange={(maxScale) => setFoliage({ maxScale })} />
      <label className="node-field">
        <span>Grass Color</span>
        <input type="color" value={foliage.grassColor} onChange={(event) => setFoliage({ grassColor: event.target.value })} />
      </label>
      <label className="node-field">
        <span>Trunk Color</span>
        <input type="color" value={foliage.trunkColor} onChange={(event) => setFoliage({ trunkColor: event.target.value })} />
      </label>
      <label className="node-field">
        <span>Tree Color</span>
        <input type="color" value={foliage.treeColor} onChange={(event) => setFoliage({ treeColor: event.target.value })} />
      </label>
    </div>
  );
}

export function TerrainEditorPanel() {
  const objects = useEditorStore(selectActiveObjects);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectObject = useEditorStore((state) => state.selectObject);
  const createObjectWithProps = useEditorStore((state) => state.createObjectWithProps);
  const brush = useEditorStore((state) => state.terrainBrush);
  const setTerrainBrush = useEditorStore((state) => state.setTerrainBrush);
  const assets = useEditorStore((state) => state.assets);
  const [tab, setTab] = useState<TerrainTab>('sculpt');

  const terrains = useMemo(() => objects.filter((object) => object.terrain), [objects]);
  const selectedTerrain = terrains.find((object) => object.id === selectedObjectId);
  const activeTerrainObject = terrains.find((object) => object.id === brush.objectId) ?? selectedTerrain ?? terrains[0];
  const terrain = activeTerrainObject?.terrain ? withTerrainDefaults(activeTerrainObject.terrain) : undefined;
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);
  const modelAssets = useMemo(() => assets.filter((asset) => asset.type === 'model'), [assets]);

  useEffect(() => {
    if (!activeTerrainObject || !terrain) return;
    const targetLayerId = terrain.materialLayers.some((layer) => layer.id === brush.targetLayerId)
      ? brush.targetLayerId
      : terrain.materialLayers[0]?.id;
    if (brush.objectId !== activeTerrainObject.id || brush.targetLayerId !== targetLayerId) {
      setTerrainBrush({ objectId: activeTerrainObject.id, targetLayerId });
    }
  }, [activeTerrainObject?.id, brush.objectId, brush.targetLayerId, setTerrainBrush, terrain]);

  const createTerrain = () => {
    const id = createObjectWithProps('terrain', {
      name: 'Open World Terrain',
      position: [0, 0, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'mesh' },
    });
    selectObject(id);
    setTerrainBrush({ enabled: true, objectId: id });
  };

  const setTabAndBrush = (next: TerrainTab) => {
    setTab(next);
    if (next === 'sculpt' || next === 'paint') setTerrainBrush({ enabled: true, mode: next as TerrainBrushMode });
  };

  return (
    <section className="panel material-panel terrain-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">World</span>
          <h2>Terrain</h2>
        </div>
        {terrains.length > 0 && (
          <select
            className="blueprint-select"
            value={activeTerrainObject?.id ?? ''}
            onChange={(event) => {
              selectObject(event.target.value);
              setTerrainBrush({ objectId: event.target.value });
            }}
          >
            {terrains.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create terrain" onClick={createTerrain}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {!activeTerrainObject || !terrain ? (
        <div className="empty-state wide">
          <Mountain size={18} aria-hidden />
          <span>No terrain yet</span>
          <button className="full-button" onClick={createTerrain}>
            Create Terrain
          </button>
        </div>
      ) : (
        <div className="terrain-editor-body">
          <aside className="node-palette terrain-toolbox">
            <div className="blueprint-card">
              <strong>{activeTerrainObject.name}</strong>
              <span>{terrain.materialLayers.length} layers</span>
            </div>
            <label className="node-field row terrain-brush-toggle">
              <span>Brush</span>
              <input type="checkbox" checked={brush.enabled} onChange={(event) => setTerrainBrush({ enabled: event.target.checked })} />
            </label>
            <div className="terrain-tab-list">
              {[
                { id: 'sculpt', label: 'Sculpt', icon: Brush },
                { id: 'paint', label: 'Paint', icon: Palette },
                { id: 'foliage', label: 'Foliage', icon: Sprout },
                { id: 'settings', label: 'Settings', icon: Settings2 },
              ].map(({ id, label, icon: Icon }) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTabAndBrush(id as TerrainTab)}>
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </aside>
          <aside className="graph-inspector terrain-controls">
            <div className="graph-inspector-header">
              <span className="eyebrow">{tab}</span>
              <h3>{activeTerrainObject.name}</h3>
            </div>
            <div className="node-inspector-body">
              {tab === 'sculpt' && <SculptControls objectId={activeTerrainObject.id} />}
              {tab === 'paint' && <PaintControls objectId={activeTerrainObject.id} terrain={terrain} imageAssets={imageAssets} />}
              {tab === 'foliage' && <FoliageControls objectId={activeTerrainObject.id} terrain={terrain} modelAssets={modelAssets} />}
              {tab === 'settings' && <TerrainSettings objectId={activeTerrainObject.id} terrain={terrain} />}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
