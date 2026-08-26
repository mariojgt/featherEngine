import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Dices, LibraryBig, Palette, Sprout, TreePine, Trees } from 'lucide-react';
import * as THREE from 'three';
import { RangeField } from '../../components/InspectorPanel';
import { generateTree } from '../../tree/generateTree';
import { TreeMesh } from '../../three/TreeMesh';
import type { SceneObject, TreeSpec } from '../../types';
import { defineFeatherPlugin, type FeatherPluginAPI } from '../types';
import {
  DEFAULT_PIXEL_TREE_RECIPE,
  PIXEL_TREE_HABITS,
  PIXEL_TREE_SPECIES,
  findPixelTreeSpecies,
  pixelTreeSignature,
  pixelTreeSpec,
  type PixelTreeHabit,
} from './presets';

export const PIXEL_ART_TREES_PLUGIN_ID = 'feather.pixel-art-trees';
const PANEL_ID = `${PIXEL_ART_TREES_PLUGIN_ID}.studio`;
const PREVIEW_SEEDS = [17, 31, 73, 127, 251];

function previewObject(spec: TreeSpec, seed: number): SceneObject {
  return {
    id: `pixel-tree-preview-${spec.id}-${seed}`,
    name: spec.name,
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tree: { enabled: true, spec, seed },
  } as SceneObject;
}

function PixelTreePreview({ spec, seed }: { spec: TreeSpec; seed: number }) {
  const object = useMemo(() => previewObject(spec, seed), [spec, seed]);
  const bounds = useMemo(() => generateTree(spec, seed).bounds, [spec, seed]);
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(1.4, Math.max(size.y, (size.x + size.z) * 0.5) * 0.6);
  const height = Math.max(1.4, size.y);
  return (
    <Canvas
      shadows
      camera={{ position: [radius * 1.45, height * 0.6, radius * 1.45], fov: 43 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#131821');
      }}
    >
      <hemisphereLight args={['#d9edff', '#253120', 1.15]} />
      <directionalLight position={[-5, 12, 7]} intensity={2.15} castShadow />
      <gridHelper args={[Math.max(8, Math.ceil(radius * 2)), 12, '#334059', '#202937']} />
      <TreeMesh object={object} />
      <OrbitControls target={[0, height * 0.45, 0]} enablePan={false} />
    </Canvas>
  );
}

/** Reuse an identical tree recipe instead of quietly filling the library with duplicate assets. */
export function ensurePixelTreeLibrarySpec(
  api: FeatherPluginAPI,
  spec: TreeSpec,
): { specId: string; created: boolean } {
  const signature = pixelTreeSignature(spec);
  const existing = api.trees.library().find((entry) => pixelTreeSignature(entry as TreeSpec) === signature);
  if (existing) return { specId: existing.id, created: false };

  const specId = api.trees.addArchetype(spec.archetype, spec.name);
  if (!api.trees.updateSpec(specId, { ...spec, id: specId })) {
    throw new Error('Feather created the tree asset but could not apply its pixel recipe.');
  }
  return { specId, created: true };
}

function PixelArtTreesPanel({ api }: { api: FeatherPluginAPI }) {
  const [speciesId, setSpeciesId] = useState(DEFAULT_PIXEL_TREE_RECIPE.speciesId);
  const [habit, setHabit] = useState<PixelTreeHabit>(DEFAULT_PIXEL_TREE_RECIPE.habit);
  const [scale, setScale] = useState(DEFAULT_PIXEL_TREE_RECIPE.scale);
  const [leafDensity, setLeafDensity] = useState(DEFAULT_PIXEL_TREE_RECIPE.leafDensity);
  const initialSpecies = findPixelTreeSpecies(DEFAULT_PIXEL_TREE_RECIPE.speciesId);
  const [leafInner, setLeafInner] = useState(initialSpecies.leaves[0]);
  const [leafOuter, setLeafOuter] = useState(initialSpecies.leaves[1]);
  const [seed, setSeed] = useState(PREVIEW_SEEDS[0]);
  const [groveCount, setGroveCount] = useState(18);
  const [groveRadius, setGroveRadius] = useState(16);
  const [status, setStatus] = useState('Choose a species and habit, then plant one tree or a whole grove.');

  const species = findPixelTreeSpecies(speciesId);
  const spec = useMemo(
    () => pixelTreeSpec({ speciesId, habit, scale, leafDensity, leafInner, leafOuter }, `pixel-preview-${speciesId}-${habit}`),
    [habit, leafDensity, leafInner, leafOuter, scale, speciesId],
  );
  const generated = useMemo(() => generateTree(spec, seed), [seed, spec]);

  const chooseSpecies = (nextId: string) => {
    const next = findPixelTreeSpecies(nextId);
    setSpeciesId(next.id);
    setLeafInner(next.leaves[0]);
    setLeafOuter(next.leaves[1]);
    setStatus(`${next.name}: ${next.tagline}`);
  };

  const attempt = (label: string, action: () => string) => {
    try {
      setStatus(action());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      api.ui.notify(`${label}: ${message}`, 'error');
    }
  };

  const saveToLibrary = () =>
    attempt('Save pixel tree', () => {
      const result = ensurePixelTreeLibrarySpec(api, spec);
      api.ui.notify(result.created ? `Added “${spec.name}” to the tree library.` : `“${spec.name}” is already in the tree library.`);
      return result.created
        ? `Saved “${spec.name}”. Every placed copy stays linked to this editable tree asset.`
        : `Reusing the matching “${spec.name}” asset already in this project.`;
    });

  const plantTree = () =>
    attempt('Plant pixel tree', () => {
      const { specId } = ensurePixelTreeLibrarySpec(api, spec);
      const objectId = api.trees.place({ specId, seed, position: [0, 0, 0], name: spec.name });
      api.objects.select(objectId);
      api.ui.notify(`Planted ${spec.name}.`);
      return `Planted the previewed seed ${seed} at the scene origin and selected it.`;
    });

  const plantGrove = () =>
    attempt('Plant pixel grove', () => {
      const { specId } = ensurePixelTreeLibrarySpec(api, spec);
      const { groupId, treeIds } = api.trees.plantGrove({
        specId,
        count: groveCount,
        radius: groveRadius,
        seed,
        name: `${spec.name} Grove`,
      });
      api.objects.select(groupId);
      api.ui.notify(`Planted ${treeIds.length} pixel-art trees.`);
      return `Planted ${treeIds.length} linked trees in a terrain-snapped grove (layout seed ${seed}).`;
    });

  return (
    <section className="panel material-panel terrain-panel pixel-art-trees-panel">
      <div className="terrain-editor-body tree-builder-body">
        <aside className="node-palette terrain-toolbox pixel-art-trees-gallery">
          <div className="pixel-art-trees-intro">
            <span className="pixel-art-trees-kicker">PROCEDURAL VEGETATION</span>
            <strong>Painted leaves, real 3D trees</strong>
            <p>Recipes are deterministic and asset-free, so forests stay lightweight and collaboration-safe.</p>
          </div>
          <div className="pixel-art-trees-species-grid">
            {PIXEL_TREE_SPECIES.map((entry) => (
              <button
                key={entry.id}
                className={`pixel-art-trees-species${entry.id === speciesId ? ' active' : ''}`}
                onClick={() => chooseSpecies(entry.id)}
                title={entry.tagline}
              >
                <span
                  className="pixel-art-trees-species-art"
                  style={{
                    '--pixel-leaf-inner': entry.leaves[0],
                    '--pixel-leaf-outer': entry.leaves[1],
                    '--pixel-bark': entry.bark[0],
                  } as React.CSSProperties}
                  aria-hidden
                />
                <span>{entry.name}</span>
                <small>{entry.leafArt}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="terrain-preview-column">
          <div className="tree-preview-canvas pixel-art-trees-canvas">
            <PixelTreePreview spec={spec} seed={seed} />
            <span className="pixel-art-trees-live-badge">32 PX LEAF ART</span>
          </div>
          <div className="tree-preview-meta">
            <span>{spec.name} · seed {seed}</span>
            <span>{generated.triangles.toLocaleString()} tris</span>
          </div>
          <div className="terrain-layer-list tree-seed-strip">
            {PREVIEW_SEEDS.map((value) => (
              <button key={value} className={value === seed ? 'active' : ''} onClick={() => setSeed(value)}>
                <span>{value}</span>
              </button>
            ))}
          </div>
          <button className="full-button" onClick={() => setSeed(1 + Math.floor(Math.random() * 999_999))}>
            <Dices size={13} aria-hidden /> Randomize tree
          </button>
          <p className="field-hint">{species.tagline} Drag the preview to inspect the canopy from every angle.</p>
        </div>

        <aside className="graph-inspector terrain-controls pixel-art-trees-controls">
          <div className="node-inspector-body">
            <div className="terrain-control-grid">
              <h4 className="inspector-subhead">Shape</h4>
              <label className="node-field">
                <span>Growth habit</span>
                <select value={habit} onChange={(event) => setHabit(event.target.value as PixelTreeHabit)}>
                  {PIXEL_TREE_HABITS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {entry.description}</option>)}
                </select>
              </label>
              <RangeField label="Tree scale" value={scale} min={0.55} max={1.8} step={0.05} onChange={setScale} />
              <RangeField label="Leaf density" value={leafDensity} min={0.5} max={1.8} step={0.05} onChange={setLeafDensity} />

              <h4 className="inspector-subhead"><Palette size={13} aria-hidden /> Palette</h4>
              <label className="node-field pixel-art-trees-color-row">
                <span>Shadow leaves</span>
                <input type="color" value={leafInner} onChange={(event) => setLeafInner(event.target.value)} />
              </label>
              <label className="node-field pixel-art-trees-color-row">
                <span>Lit leaves</span>
                <input type="color" value={leafOuter} onChange={(event) => setLeafOuter(event.target.value)} />
              </label>
              <button className="full-button" onClick={() => { setLeafInner(species.leaves[0]); setLeafOuter(species.leaves[1]); }}>
                Reset species palette
              </button>

              <h4 className="inspector-subhead">Create</h4>
              <button className="full-button primary" onClick={plantTree}>
                <Sprout size={13} aria-hidden /> Plant This Tree
              </button>
              <div className="pixel-art-trees-grove-row">
                <RangeField label="Trees" value={groveCount} min={3} max={60} step={1} onChange={(value) => setGroveCount(Math.round(value))} />
                <RangeField label="Radius" value={groveRadius} min={4} max={80} step={1} onChange={(value) => setGroveRadius(Math.round(value))} />
              </div>
              <button className="full-button primary" onClick={plantGrove}>
                <Trees size={13} aria-hidden /> Plant Pixel Grove
              </button>
              <button className="full-button" onClick={saveToLibrary}>
                <LibraryBig size={13} aria-hidden /> Save to Tree Library
              </button>
              <button className="full-button" onClick={() => api.panels.open('trees')}>
                <TreePine size={13} aria-hidden /> Fine-tune in Tree Builder
              </button>
              <p className="field-hint pixel-art-trees-status">{status}</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export const pixelArtTreesPlugin = defineFeatherPlugin({
  id: PIXEL_ART_TREES_PLUGIN_ID,
  name: 'Pixel Art Trees',
  version: '1.0.0',
  description:
    'Procedural pixel vegetation studio with nine painted leaf languages, five growth habits, palette controls, deterministic seeds and one-click groves.',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Pixel Art Trees',
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <PixelArtTreesPanel api={api} />,
    });

    api.commands.register({
      id: `${PIXEL_ART_TREES_PLUGIN_ID}.open`,
      title: 'Open Pixel Art Trees',
      group: 'Extensions',
      keywords: 'pixel tree vegetation forest grove leaves rpg nature',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PIXEL_ART_TREES_PLUGIN_ID}.quick-grove`,
      title: 'Plant a pixel-art oak grove',
      group: 'Extensions',
      keywords: 'pixel tree grove forest quick plant',
      run: () => {
        try {
          const spec = pixelTreeSpec(DEFAULT_PIXEL_TREE_RECIPE, 'pixel-quick-oak');
          const { specId } = ensurePixelTreeLibrarySpec(api, spec);
          const { groupId, treeIds } = api.trees.plantGrove({ specId, count: 16, radius: 15 });
          api.objects.select(groupId);
          api.ui.notify(`Planted ${treeIds.length} pixel-art oak trees.`);
        } catch (error) {
          api.ui.notify(error instanceof Error ? error.message : String(error), 'error');
        }
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
