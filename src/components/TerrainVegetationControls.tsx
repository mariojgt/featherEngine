import { useState } from 'react';
import type { TerrainComponent } from '../types';
import { useEditorStore } from '../store/editorStore';
import { TERRAIN_BIOMES, type TerrainBiomeId } from '../terrain/biomes';

/** Species and habitat controls use the same update action as the assistant and saved projects. */
export function TerrainVegetationControls({ objectId, terrain }: { objectId: string; terrain: TerrainComponent }) {
  const specs = useEditorStore((state) => state.treeSpecs);
  const update = useEditorStore((state) => state.updateTerrain);
  const applyBiome = useEditorStore((state) => state.applyTerrainBiome);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const foliage = terrain.foliage;
  const set = (patch: Partial<typeof foliage>) => update(objectId, { foliage: { ...foliage, ...patch } });
  const species = foliage.treeSpecies ?? [];
  return <>
    <label className="node-field">
      <span>Landscape preset</span>
      <select aria-label="Apply landscape preset" value="" disabled={applying} onChange={async (event) => {
        const biome = event.target.value as TerrainBiomeId;
        if (!biome) return;
        setApplying(true); setError('');
        try { await applyBiome(objectId, biome); }
        catch { setError('The bundled landscape assets could not be loaded. Please try again.'); }
        finally { setApplying(false); }
      }}>
        <option value="">{applying ? 'Applying landscape…' : 'Choose a preset…'}</option>
        {Object.entries(TERRAIN_BIOMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="field-hint">{error}</p>}
    <p className="field-hint">Woodland and Meadow include two textured tree forms; Alpine uses editable tree species. Woodland adds fern clumps, mossy rocks, and decayed wood. Applies scanned ground surfaces and natural grass. Your sculpting and painted masks stay in place.</p>
    <label className="node-field">
      <span>Plant distribution</span>
      <select aria-label="Plant distribution" value={foliage.distribution ?? 'uniform'} onChange={event => set({ distribution: event.target.value as 'uniform' | 'woodland' })}>
        <option value="uniform">Uniform</option><option value="woodland">Woodland groves</option>
      </select>
    </label>
    <p className="field-hint">Woodland groups spaced trees into groves and leaves less grass beneath their canopies.</p>
    {foliage.understoryAssetId && <label className="node-field">
      <span>Forest ground cover</span>
      <input aria-label="Forest ground cover" type="range" min={0} max={1} step={0.05} value={foliage.understoryDensity ?? 0}
        onChange={event => set({ understoryDensity: Number(event.target.value) })} />
    </label>}
    <label className="node-field">
      <span>Tree spacing</span>
      <input type="number" min={0} max={64} step={1} value={foliage.treeSpacing ?? 0} onChange={(event) => set({ treeSpacing: Number(event.target.value) })} />
    </label>
    <p className="field-hint">Minimum separation in terrain units. 0 keeps the original scatter pattern.</p>
    {(['minElevation', 'maxElevation'] as const).map((key) => <label key={key} className="node-field">
      <span>{key === 'minElevation' ? 'Min elevation' : 'Max elevation'}</span>
      <input type="number" min={-512} max={512} step={1} placeholder="Unrestricted" value={foliage[key] ?? ''}
        onChange={(event) => set({ [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) })} />
    </label>)}
    <p className="field-hint">Local terrain heights for shorelines and tree lines. Clear a value to remove that limit.</p>
    {(foliage.treeSource ?? 'builtin') === 'builtin' && <>
      <label className="node-field">
        <span>Species mix</span>
        <select aria-label="Add forest species" value="" disabled={species.length >= 4} onChange={(event) => {
          if (event.target.value) set({ treeSpecies: [...species, { specId: event.target.value, weight: 1 }] });
        }}>
          <option value="">{species.length >= 4 ? 'Four species selected' : 'Add a species…'}</option>
          {specs.filter((spec) => !species.some((entry) => entry.specId === spec.id)).map((spec) => <option key={spec.id} value={spec.id}>{spec.name}</option>)}
        </select>
      </label>
      {species.map((entry) => <div className="terrain-button-row" key={entry.specId}>
        <label className="node-field" style={{ flex: 1 }}>
          <span>{specs.find((spec) => spec.id === entry.specId)?.name ?? 'Missing species'}</span>
          <input type="number" aria-label={`Weight for ${entry.specId}`} min={0.01} max={100} step={0.25} value={entry.weight}
            onChange={(event) => set({ treeSpecies: species.map((other) => other.specId === entry.specId ? { ...other, weight: Number(event.target.value) } : other) })} />
        </label>
        <button className="icon-button compact" title="Remove species from mix" onClick={() => set({ treeSpecies: species.filter((other) => other.specId !== entry.specId) })}>×</button>
      </div>)}
      <p className="field-hint">Weights control the proportion of each species. An empty mix uses the selected single tree asset.</p>
    </>}
  </>;
}
