import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Dices, LibraryBig, Sprout, TreePine, Trees } from 'lucide-react';
import * as THREE from 'three';
import { generateTree } from '../tree/generateTree';
import { STYLIZED_TREE_PRESETS, stylizedTreeSpec, type StylizedTreePreset } from '../tree/stylizedPresets';
import { TreeMesh } from '../three/TreeMesh';
import { RangeField } from '../components/RangeField';
import type { SceneObject, TreeSpec } from '../types';
import { defineFeatherPlugin, type FeatherPluginAPI } from './types';

/**
 * Arbor Forge — the store-installable stylized-tree studio, and the reference gallery plugin.
 *
 * Everything here goes through the public plugin API (api.trees / api.panels / api.ui): the plugin
 * adds no engine code of its own, which is exactly the shape an outside plugin author would ship.
 * The presets themselves live in src/tree/stylizedPresets.ts so the AI assistant can offer the
 * same trees whether or not this plugin is installed.
 */

const PLUGIN_ID = 'feather.arbor-forge';
const PANEL_ID = `${PLUGIN_ID}.studio`;

/** Six seeds of the selected preset — the same "one spec covers a forest" lesson the Tree Builder teaches. */
const SEED_STRIP = [1, 2, 3, 4, 5, 6];

/** A throwaway SceneObject so the preview renders through the REAL TreeMesh, not a bespoke copy. */
function previewObject(spec: TreeSpec, seed: number): SceneObject {
  return {
    id: `arbor-preview-${spec.id}-${seed}`,
    name: spec.name,
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tree: { enabled: true, spec, seed },
  } as SceneObject;
}

function PresetPreview({ spec, seed }: { spec: TreeSpec; seed: number }) {
  const object = useMemo(() => previewObject(spec, seed), [spec, seed]);
  // Frame off generated bounds, not trunk height — a canopy is usually wider than the trunk is tall.
  // Averaging the axes (instead of taking the max) stops one stray limb from shrinking the whole
  // tree to a miniature; a slightly clipped outlier branch beats a postage-stamp preview.
  const bounds = useMemo(() => generateTree(spec, seed).bounds, [spec, seed]);
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(1.5, Math.max(size.y, (size.x + size.z) * 0.5) * 0.62);
  const height = Math.max(1.5, size.y);
  return (
    <Canvas
      shadows
      camera={{ position: [radius * 1.5, height * 0.62, radius * 1.5], fov: 45 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#1a1f27');
      }}
    >
      <hemisphereLight args={['#cfe6ff', '#3a4433', 1.0]} />
      <directionalLight position={[6, 12, 5]} intensity={2.0} castShadow />
      <gridHelper args={[Math.max(8, Math.ceil(radius * 2)), 12, '#30394D', '#232a36']} />
      <TreeMesh object={object} />
      <OrbitControls target={[0, height * 0.45, 0]} enablePan={false} />
    </Canvas>
  );
}

function ArborForgePanel({ api }: { api: FeatherPluginAPI }) {
  const [presetId, setPresetId] = useState<string>(STYLIZED_TREE_PRESETS[0].id);
  const [seed, setSeed] = useState(1);
  const [groveCount, setGroveCount] = useState(14);
  const [groveRadius, setGroveRadius] = useState(16);
  const [status, setStatus] = useState('Pick a preset, explore its seeds, then plant it.');

  const preset =
    STYLIZED_TREE_PRESETS.find((entry) => entry.id === presetId) ?? STYLIZED_TREE_PRESETS[0];
  const spec = useMemo(() => stylizedTreeSpec(preset, `arbor-preview-${preset.id}`), [preset]);
  const generated = useMemo(() => generateTree(spec, seed), [spec, seed]);

  /** Every mutation funnels through here so a Play-mode or no-project error reads in the panel, not the console. */
  const attempt = (label: string, action: () => string) => {
    try {
      setStatus(action());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      api.ui.notify(`${label}: ${message}`, 'error');
    }
  };

  const addToLibrary = () =>
    attempt('Add to library', () => {
      const specId = api.trees.addPreset(preset.id);
      api.ui.notify(`"${preset.name}" added to the tree library.`);
      return `Added "${preset.name}" to the library (${specId}). Open the Tree Builder to fine-tune it.`;
    });

  const plantTree = () =>
    attempt('Plant tree', () => {
      // The previewed seed is the planted seed — what you see is exactly what lands in the scene.
      // A small jittered offset keeps repeated clicks from stacking trees inside each other.
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * 5;
      const objectId = api.trees.place({
        presetId: preset.id,
        seed,
        position: [Math.cos(angle) * distance, 0, Math.sin(angle) * distance],
      });
      api.objects.select(objectId);
      return `Planted a ${preset.name} (seed ${seed}) near the origin — it snaps to the terrain under it.`;
    });

  const plantGrove = () =>
    attempt('Plant grove', () => {
      const { groupId, treeIds } = api.trees.plantGrove({
        presetId: preset.id,
        count: groveCount,
        radius: groveRadius,
      });
      api.objects.select(groupId);
      api.ui.notify(`Planted ${treeIds.length} ${preset.name} trees.`);
      return `Planted a grove of ${treeIds.length} — grouped under one object, all linked to the "${preset.name}" asset.`;
    });

  return (
    <section className="panel material-panel terrain-panel">
      <div className="terrain-editor-body tree-builder-body">
        <aside className="node-palette terrain-toolbox arbor-gallery">
          <div className="arbor-preset-grid">
            {STYLIZED_TREE_PRESETS.map((entry: StylizedTreePreset) => (
              <button
                key={entry.id}
                className={`arbor-preset-card${entry.id === preset.id ? ' active' : ''}`}
                onClick={() => setPresetId(entry.id)}
                title={entry.tagline}
              >
                <span
                  className="arbor-preset-swatch"
                  style={{ background: `linear-gradient(135deg, ${entry.art.from}, ${entry.art.to})` }}
                  aria-hidden
                />
                <span className="arbor-preset-name">{entry.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="terrain-preview-column">
          <div className="tree-preview-canvas">
            <PresetPreview spec={spec} seed={seed} />
          </div>
          <div className="tree-preview-meta">
            <span>
              {preset.name} · seed {seed}
            </span>
            <span>{generated.triangles.toLocaleString()} tris</span>
          </div>
          <div className="terrain-layer-list tree-seed-strip">
            {SEED_STRIP.map((value) => (
              <button key={value} className={value === seed ? 'active' : ''} onClick={() => setSeed(value)}>
                <span>{value}</span>
              </button>
            ))}
          </div>
          <button className="full-button" onClick={() => setSeed(1 + Math.floor(Math.random() * 999_999))}>
            <Dices size={13} aria-hidden /> Shuffle seed
          </button>
          <p className="field-hint">{preset.tagline}</p>
        </div>

        <aside className="graph-inspector terrain-controls">
          <div className="node-inspector-body">
            <div className="terrain-control-grid">
              <h4 className="inspector-subhead">Plant</h4>
              <button className="full-button primary" onClick={plantTree}>
                <Sprout size={13} aria-hidden /> Plant This Tree
              </button>

              <h4 className="inspector-subhead">Grove</h4>
              <RangeField label="Trees" value={groveCount} min={3} max={60} step={1} onChange={(value) => setGroveCount(Math.round(value))} />
              <RangeField label="Radius" value={groveRadius} min={4} max={80} step={1} onChange={(value) => setGroveRadius(Math.round(value))} />
              <button className="full-button primary" onClick={plantGrove}>
                <Trees size={13} aria-hidden /> Plant Grove
              </button>
              <p className="field-hint">
                Groves land on a jittered natural scatter, snap to the terrain, and stay grouped under one object.
              </p>

              <h4 className="inspector-subhead">Library</h4>
              <button className="full-button" onClick={addToLibrary}>
                <LibraryBig size={13} aria-hidden /> Add to Tree Library
              </button>
              <button className="full-button" onClick={() => api.panels.open('trees')}>
                <TreePine size={13} aria-hidden /> Open Tree Builder
              </button>
              <p className="field-hint">
                Planted trees link to one shared asset — restyle it in the Tree Builder and the whole
                grove (and any terrain scatter using it) updates at once.
              </p>
              <p className="field-hint">{status}</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export const arborForgePlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Arbor Forge',
  version: '1.0.0',
  description:
    'Stylized tree studio: twelve hand-tuned presets with a live seed-explorer preview, one-click planting and natural grove scattering.',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Arbor Forge',
      // A gallery + 3D preview + controls needs Tree-Builder width, so it docks below the viewport.
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <ArborForgePanel api={api} />,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open`,
      title: 'Open Arbor Forge (stylized trees)',
      group: 'Extensions',
      keywords: 'tree forest grove sakura stylized plant nature',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PLUGIN_ID}.surprise-grove`,
      title: 'Plant a surprise stylized grove',
      group: 'Extensions',
      keywords: 'tree grove random forest plant',
      run: () => {
        const preset = STYLIZED_TREE_PRESETS[Math.floor(Math.random() * STYLIZED_TREE_PRESETS.length)];
        const { groupId, treeIds } = api.trees.plantGrove({ presetId: preset.id, count: 12, radius: 14 });
        api.objects.select(groupId);
        api.ui.notify(`Planted ${treeIds.length} ${preset.name} trees — surprise!`);
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
