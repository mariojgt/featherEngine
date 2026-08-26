import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Copy, Plus, TreePine, Trash2 } from 'lucide-react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { generateTree } from '../tree/generateTree';
import { PIXEL_LEAF_ARTS } from '../tree/pixelCanopy';
import { treeSpecFromArchetype } from '../tree/treeSpec';
import { TreeMesh } from '../three/TreeMesh';
import type { SceneObject, TreeArchetype, TreePixelLeafArt, TreeSpec } from '../types';
import { RangeField } from './InspectorPanel';

/**
 * The Tree Builder — authors the project's reusable tree assets.
 *
 * Editing a spec here updates EVERY tree that references it (placed objects and terrain-scattered ones
 * alike), which is the whole point of keeping trees as spec+seed instead of baked meshes.
 *
 * The preview builds a throwaway SceneObject and renders it through the real TreeMesh, so what you tune is
 * literally what the scene draws — a bespoke preview renderer would drift from the real one over time.
 */

const ARCHETYPES: { value: TreeArchetype; label: string }[] = [
  { value: 'broadleaf', label: 'Broadleaf' },
  { value: 'conifer', label: 'Conifer' },
  { value: 'birch', label: 'Birch' },
  { value: 'willow', label: 'Willow' },
  { value: 'palm', label: 'Palm' },
  { value: 'shrub', label: 'Shrub' },
  { value: 'snag', label: 'Dead tree' },
];

/** Six seeds of the current spec — clicking one adopts it. How users learn one spec covers a forest. */
const SEED_STRIP = [1, 2, 3, 4, 5, 6];

function previewObject(spec: TreeSpec, seed: number): SceneObject {
  return {
    id: `tree-preview-${spec.id}-${seed}`,
    name: spec.name,
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tree: { enabled: true, spec, seed },
  } as SceneObject;
}

function TreePreview({ spec, seed }: { spec: TreeSpec; seed: number }) {
  const object = useMemo(() => previewObject(spec, seed), [spec, seed]);
  // Frame off the generated BOUNDS, not the trunk height: a broadleaf's canopy is far wider than its
  // trunk is tall, and trunk-height framing parks the camera inside the leaves.
  const bounds = useMemo(() => generateTree(spec, seed).bounds, [spec, seed]);
  const size = bounds.getSize(new THREE.Vector3());
  // Average the axes so one stray limb doesn't shrink the tree to a miniature.
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

export function TreeBuilderPanel() {
  const treeSpecs = useEditorStore((state) => state.treeSpecs);
  const activeTreeSpecId = useEditorStore((state) => state.activeTreeSpecId);
  const setActiveTreeSpec = useEditorStore((state) => state.setActiveTreeSpec);
  const createTreeSpec = useEditorStore((state) => state.createTreeSpec);
  const updateTreeSpec = useEditorStore((state) => state.updateTreeSpec);
  const duplicateTreeSpec = useEditorStore((state) => state.duplicateTreeSpec);
  const deleteTreeSpec = useEditorStore((state) => state.deleteTreeSpec);
  const createTree = useEditorStore((state) => state.createTree);
  const [seed, setSeed] = useState(1);

  const spec = treeSpecs.find((entry) => entry.id === activeTreeSpecId) ?? treeSpecs[0];
  const generated = useMemo(() => (spec ? generateTree(spec, seed) : null), [spec, seed]);

  if (!spec) {
    return (
      <section className="panel material-panel">
        <div className="empty-state wide">
          <TreePine size={18} aria-hidden />
          <span>No tree assets yet</span>
          <button className="full-button" onClick={() => createTreeSpec('broadleaf', 'Oak')}>
            Create Tree
          </button>
        </div>
      </section>
    );
  }

  const patch = (next: Partial<TreeSpec>) => updateTreeSpec(spec.id, next);
  const patchChop = (next: Partial<TreeSpec['chop']>) => patch({ chop: { ...spec.chop, ...next } });

  return (
    <section className="panel material-panel terrain-panel">
      <div className="panel-header panel-header-actions-only">
        <button className="icon-button compact" title="New tree asset" onClick={() => createTreeSpec('broadleaf')}>
          <Plus size={14} aria-hidden />
        </button>
      </div>

      <div className="terrain-editor-body tree-builder-body">
        <aside className="node-palette terrain-toolbox">
          <div className="terrain-layer-list">
            {treeSpecs.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === spec.id ? 'active' : ''}
                onClick={() => setActiveTreeSpec(entry.id)}
                title={`${entry.name} · ${entry.archetype}`}
              >
                <TreePine size={13} aria-hidden />
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
          <button className="full-button" onClick={() => duplicateTreeSpec(spec.id)}>
            <Copy size={13} aria-hidden /> Duplicate
          </button>
          <button className="full-button danger-soft" onClick={() => deleteTreeSpec(spec.id)}>
            <Trash2 size={13} aria-hidden /> Delete
          </button>
          <button className="full-button" onClick={() => createTree(spec.archetype)}>
            Place in Scene
          </button>
        </aside>

        <div className="terrain-preview-column">
          <div className="tree-preview-canvas">
            <TreePreview spec={spec} seed={seed} />
          </div>
          <div className="tree-preview-meta">
            <span>seed {seed}</span>
            <span>{generated ? `${generated.triangles.toLocaleString()} tris` : ''}</span>
          </div>
          <div className="terrain-layer-list tree-seed-strip">
            {SEED_STRIP.map((value) => (
              <button key={value} className={value === seed ? 'active' : ''} onClick={() => setSeed(value)}>
                <span>{value}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">
            Every tree using this asset shares the spec but keeps its own seed — one asset covers a whole forest.
          </p>
        </div>

        <aside className="graph-inspector terrain-controls">
          <div className="node-inspector-body">
            <div className="terrain-control-grid">
              <label className="node-field">
                <span>Name</span>
                <input value={spec.name} onChange={(event) => patch({ name: event.target.value })} />
              </label>
              <label className="node-field">
                <span>Archetype</span>
                <select
                  value={spec.archetype}
                  onChange={(event) => {
                    // Rebuilding from an archetype resets tuning on purpose — archetypes are starting points.
                    const next = event.target.value as TreeArchetype;
                    updateTreeSpec(spec.id, { ...treeSpecFor(next, spec), archetype: next });
                  }}
                >
                  {ARCHETYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <h4 className="inspector-subhead">Trunk</h4>
              <RangeField label="Height" value={spec.trunk.height} min={0.2} max={30} step={0.1} onChange={(height) => patch({ trunk: { ...spec.trunk, height } })} />
              <RangeField label="Base Radius" value={spec.trunk.baseRadius} min={0.02} max={2} step={0.01} onChange={(baseRadius) => patch({ trunk: { ...spec.trunk, baseRadius } })} />
              <RangeField label="Taper" value={spec.trunk.taper} min={0.05} max={1} step={0.01} onChange={(taper) => patch({ trunk: { ...spec.trunk, taper } })} />
              <RangeField label="Lean" value={spec.trunk.lean} min={-45} max={45} step={1} onChange={(lean) => patch({ trunk: { ...spec.trunk, lean } })} />
              <RangeField label="Curl" value={spec.trunk.curl} min={0} max={1} step={0.01} onChange={(curl) => patch({ trunk: { ...spec.trunk, curl } })} />
              <RangeField label="Root Flare" value={spec.trunk.flare} min={0} max={1} step={0.01} onChange={(flare) => patch({ trunk: { ...spec.trunk, flare } })} />
              <RangeField label="Bark Gnarl" value={spec.trunk.gnarl} min={0} max={1} step={0.01} onChange={(gnarl) => patch({ trunk: { ...spec.trunk, gnarl } })} />

              <h4 className="inspector-subhead">Branches</h4>
              <RangeField label="Levels" value={spec.branches.levels} min={0} max={3} step={1} onChange={(levels) => patch({ branches: { ...spec.branches, levels } })} />
              <RangeField label="Angle" value={spec.branches.angle} min={0} max={120} step={1} onChange={(angle) => patch({ branches: { ...spec.branches, angle } })} />
              <RangeField label="Gravity" value={spec.branches.gravity} min={-1} max={1} step={0.05} onChange={(gravity) => patch({ branches: { ...spec.branches, gravity } })} />
              <RangeField label="Length Ratio" value={spec.branches.lengthRatio} min={0.1} max={0.95} step={0.01} onChange={(lengthRatio) => patch({ branches: { ...spec.branches, lengthRatio } })} />
              <p className="field-hint">Levels above 2 roughly triples the triangle count and is rarely visible past 20 units.</p>

              <h4 className="inspector-subhead">Foliage</h4>
              <label className="node-field">
                <span>Style</span>
                <select value={spec.foliage.strategy} onChange={(event) => patch({ foliage: { ...spec.foliage, strategy: event.target.value as TreeSpec['foliage']['strategy'] } })}>
                  <option value="clusters">Stylized clusters</option>
                  <option value="blob">Soft blobs</option>
                  <option value="cards">Leaf cards</option>
                  <option value="skirt">Conifer skirt</option>
                  <option value="fronds">Palm fronds</option>
                  <option value="strands">Hanging strands</option>
                  <option value="none">None (bare)</option>
                </select>
              </label>
              <RangeField label="Size" value={spec.foliage.size} min={0.05} max={5} step={0.05} onChange={(size) => patch({ foliage: { ...spec.foliage, size } })} />
              <RangeField label="Density" value={spec.foliage.density} min={0} max={10} step={0.5} onChange={(density) => patch({ foliage: { ...spec.foliage, density } })} />
              <RangeField label="Droop" value={spec.foliage.droop} min={0} max={1} step={0.01} onChange={(droop) => patch({ foliage: { ...spec.foliage, droop } })} />
              {(spec.foliage.strategy === 'clusters' || spec.foliage.strategy === 'blob' || spec.foliage.strategy === 'cards') && (
                <>
                  <RangeField
                    label="Crown Radius"
                    value={spec.foliage.crownRadius}
                    min={0.1}
                    max={1.5}
                    step={0.01}
                    onChange={(crownRadius) => patch({ foliage: { ...spec.foliage, crownRadius } })}
                  />
                  <RangeField
                    label="Crown Lift"
                    value={spec.foliage.crownLift}
                    min={0.2}
                    max={1}
                    step={0.01}
                    onChange={(crownLift) => patch({ foliage: { ...spec.foliage, crownLift } })}
                  />
                  <RangeField
                    label="Crown Fill"
                    value={spec.foliage.crownFill}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(crownFill) => patch({ foliage: { ...spec.foliage, crownFill } })}
                  />
                  <p className="field-hint">Crown fill paints an Unreal-style canopy volume; tip anchors keep the foliage tied to branches.</p>
                </>
              )}
              <h4 className="inspector-subhead">Colour</h4>
              <label className="node-field">
                <span>Bark</span>
                <input type="color" value={spec.look.barkRamp[0]} onChange={(event) => patch({ look: { ...spec.look, barkRamp: [event.target.value, spec.look.barkRamp[1] ?? event.target.value] } })} />
              </label>
              <label className="node-field">
                <span>Bark Tip</span>
                <input type="color" value={spec.look.barkRamp[1] ?? spec.look.barkRamp[0]} onChange={(event) => patch({ look: { ...spec.look, barkRamp: [spec.look.barkRamp[0], event.target.value] } })} />
              </label>
              <label className="node-field">
                <span>Leaf Inner</span>
                <input type="color" value={spec.look.foliageRamp[0]} onChange={(event) => patch({ look: { ...spec.look, foliageRamp: [event.target.value, spec.look.foliageRamp[1] ?? event.target.value] } })} />
              </label>
              <label className="node-field">
                <span>Leaf Outer</span>
                <input type="color" value={spec.look.foliageRamp[1] ?? spec.look.foliageRamp[0]} onChange={(event) => patch({ look: { ...spec.look, foliageRamp: [spec.look.foliageRamp[0], event.target.value] } })} />
              </label>
              <RangeField label="Canopy AO" value={spec.look.aoStrength} min={0} max={1} step={0.01} onChange={(aoStrength) => patch({ look: { ...spec.look, aoStrength } })} />

              <h4 className="inspector-subhead">Pixel Canopy</h4>
              <label className="node-field row">
                <span>Painted Leaf Cards</span>
                <input
                  type="checkbox"
                  checked={spec.look.pixelArt.enabled}
                  onChange={(event) =>
                    patch({
                      look: { ...spec.look, pixelArt: { ...spec.look.pixelArt, enabled: event.target.checked } },
                      foliage: event.target.checked ? { ...spec.foliage, strategy: 'cards' } : spec.foliage,
                    })
                  }
                />
              </label>
              {spec.look.pixelArt.enabled && (
                <>
                  <label className="node-field">
                    <span>Leaf Language</span>
                    <select
                      value={spec.look.pixelArt.leafArt}
                      onChange={(event) =>
                        patch({
                          look: {
                            ...spec.look,
                            pixelArt: { ...spec.look.pixelArt, leafArt: event.target.value as TreePixelLeafArt },
                          },
                        })
                      }
                    >
                      {PIXEL_LEAF_ARTS.map((leafArt) => <option key={leafArt} value={leafArt}>{leafArt}</option>)}
                    </select>
                  </label>
                  <RangeField
                    label="Cutout Edge"
                    value={spec.look.pixelArt.alphaCutoff}
                    min={0.05}
                    max={0.95}
                    step={0.01}
                    onChange={(alphaCutoff) => patch({ look: { ...spec.look, pixelArt: { ...spec.look.pixelArt, alphaCutoff } } })}
                  />
                  <label className="node-field row">
                    <span>Face Camera</span>
                    <input
                      type="checkbox"
                      checked={spec.look.pixelArt.billboard}
                      onChange={(event) => patch({ look: { ...spec.look, pixelArt: { ...spec.look.pixelArt, billboard: event.target.checked } } })}
                    />
                  </label>
                  <p className="field-hint">The atlas is generated from code and stored as a recipe, so no external sprite files are needed.</p>
                </>
              )}

              <h4 className="inspector-subhead">Chopping</h4>
              <label className="node-field row">
                <span>Choppable</span>
                <input type="checkbox" checked={spec.chop.enabled} onChange={(event) => patchChop({ enabled: event.target.checked })} />
              </label>
              <p className="field-hint">Break points are heights up the trunk where it can be severed. The lowest fells the tree; higher ones buck the downed trunk into logs.</p>
              {spec.chop.breakPoints.map((bp, index) => (
                <div key={index} className="node-field row tree-breakpoint-row">
                  <span>{bp.label ?? `Cut ${index + 1}`}</span>
                  <input
                    type="number"
                    value={Number(bp.height.toFixed(2))}
                    min={0.01}
                    max={0.98}
                    step={0.01}
                    onChange={(event) =>
                      patchChop({ breakPoints: spec.chop.breakPoints.map((item, i) => (i === index ? { ...item, height: Number(event.target.value) } : item)) })
                    }
                  />
                  <input
                    type="number"
                    value={bp.hits}
                    min={1}
                    step={1}
                    onChange={(event) =>
                      patchChop({ breakPoints: spec.chop.breakPoints.map((item, i) => (i === index ? { ...item, hits: Math.trunc(Number(event.target.value)) } : item)) })
                    }
                  />
                  <button className="icon-button compact" title="Remove break point" onClick={() => patchChop({ breakPoints: spec.chop.breakPoints.filter((_, i) => i !== index) })}>
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              ))}
              <p className="field-hint">Height up the trunk (0–1), then hits to sever.</p>
              <button
                className="full-button"
                onClick={() =>
                  patchChop({
                    breakPoints: [
                      ...spec.chop.breakPoints,
                      { height: Math.min(0.95, (spec.chop.breakPoints.at(-1)?.height ?? 0.1) + 0.2), hits: 2 },
                    ],
                  })
                }
              >
                Add Break Point
              </button>
              <RangeField label="Hit Tolerance" value={spec.chop.tolerance} min={0.1} max={4} step={0.1} onChange={(tolerance) => patchChop({ tolerance })} />
              <RangeField label="Topple Push" value={spec.chop.topplePush} min={0} max={20} step={0.5} onChange={(topplePush) => patchChop({ topplePush })} />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Archetype swap keeps the asset's identity (id/name) and replaces only the shape parameters. */
function treeSpecFor(archetype: TreeArchetype, current: TreeSpec): Partial<TreeSpec> {
  const fresh = treeSpecFromArchetype(archetype, current.id, current.name);
  return { ...fresh, id: current.id, name: current.name };
}
