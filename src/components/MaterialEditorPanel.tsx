import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';
import { Hash, LayoutGrid, Palette, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useAssetTexture, useAssetUrl } from '../three/ModelAsset';
import { useResolvedMaterial } from '../three/resolveMaterial';
import { NodeForgeGraphNode } from './NodeForgeGraphNode';
import { NodeSearchMenu, type NodeChoice } from './NodeSearchMenu';
import { PaletteGroup } from './PaletteGroup';
import { RangeField } from './InspectorPanel';
import type { AssetItem, GraphNodeCategory, MaterialDefinition, MeshRendererComponent, NodeForgeNode } from '../types';
import { MATERIAL_PRESETS } from '../three/presets';

const nodeTypes: NodeTypes = { nodeforge: NodeForgeGraphNode };

// `key` is the nodeKindByLabel key passed to addMaterialNode; `label` is the friendly button text.
const paletteGroups: Array<{ title: string; icon: typeof Palette; nodes: Array<{ label: string; key: string }> }> = [
  {
    title: 'Inputs',
    icon: Hash,
    nodes: [
      { label: 'Color', key: 'Color' },
      { label: 'Scalar', key: 'Scalar' },
      { label: 'Texture', key: 'Texture' },
    ],
  },
  {
    title: 'Operators',
    icon: SlidersHorizontal,
    nodes: [
      { label: 'Mix', key: 'Mix' },
      { label: 'Multiply', key: 'Multiply (Material)' },
      { label: 'Add', key: 'Add (Material)' },
      { label: 'Clamp', key: 'Clamp (Material)' },
    ],
  },
];

const nodeChoices: NodeChoice[] = [
  { label: 'Color', category: 'Material' },
  { label: 'Scalar', category: 'Material' },
  { label: 'Texture', category: 'Material' },
  { label: 'Mix', category: 'Material' },
  { label: 'Multiply', category: 'Material', nodeLabel: 'Multiply (Material)' },
  { label: 'Add', category: 'Material', nodeLabel: 'Add (Material)' },
  { label: 'Clamp', category: 'Material', nodeLabel: 'Clamp (Material)' },
];

/** A live sphere preview that mirrors exactly how the material resolves (graph + flat fields). */
function MaterialPreview({ material }: { material: MaterialDefinition }) {
  const renderer = useMemo<MeshRendererComponent>(
    () => ({ enabled: true, mesh: 'cube', color: '#ffffff', metalness: 0, roughness: 1, materialId: material.id }),
    [material.id],
  );
  const resolved = useResolvedMaterial(renderer);
  const baseTexture = useAssetTexture(resolved.baseColorUrl, true);
  const normalTexture = useAssetTexture(resolved.normalUrl, true);

  return (
    <mesh castShadow>
      <sphereGeometry args={[1, 48, 32]} />
      <meshStandardMaterial
        color={resolved.color}
        metalness={resolved.metalness}
        roughness={resolved.roughness}
        emissive={resolved.emissiveColor}
        emissiveIntensity={resolved.emissiveIntensity}
        map={baseTexture ?? null}
        normalMap={normalTexture ?? null}
      />
    </mesh>
  );
}

function ImageSelect({
  label,
  value,
  imageAssets,
  onChange,
}: {
  label: string;
  value?: string;
  imageAssets: AssetItem[];
  onChange: (assetId?: string) => void;
}) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">None</option>
        {imageAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Right-hand editor for the selected material-graph node. */
function MaterialNodeInspector({
  node,
  material,
  imageAssets,
}: {
  node: NodeForgeNode | undefined;
  material: MaterialDefinition;
  imageAssets: AssetItem[];
}) {
  const updateGraphNodeData = useEditorStore((state) => state.updateGraphNodeData);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);

  if (!node) {
    return (
      <aside className="graph-inspector">
        <div className="graph-inspector-header">
          <span className="eyebrow">Node Inspector</span>
          <h3>Nothing selected</h3>
        </div>
        <div className="node-inspector-body">
          <p className="nfn-desc">Select a node to edit it. Wire inputs into Material Output to override the base surface.</p>
        </div>
      </aside>
    );
  }

  const kind = node.data.nodeKind;
  return (
    <aside className="graph-inspector">
      <div className="graph-inspector-header">
        <span className="eyebrow">Node Inspector</span>
        <h3>{node.data.label}</h3>
      </div>
      <div className="node-inspector-body">
        {kind === 'material.color' && (
          <label className="node-field">
            <span>Color</span>
            <input
              type="color"
              value={node.data.materialColor ?? '#ffffff'}
              onChange={(event) => updateGraphNodeData(node.id, { materialColor: event.target.value })}
            />
          </label>
        )}

        {(kind === 'material.scalar' || kind === 'material.mix') && (
          <label className="node-field">
            <span>{kind === 'material.mix' ? 'Factor (T)' : 'Value'}</span>
            <input
              type="number"
              step="0.05"
              value={node.data.numberValue ?? 0}
              onChange={(event) => updateGraphNodeData(node.id, { numberValue: Number(event.target.value) })}
            />
          </label>
        )}

        {kind === 'material.texture' && (
          <ImageSelect
            label="Image"
            value={node.data.assetId}
            imageAssets={imageAssets}
            onChange={(assetId) => updateGraphNodeData(node.id, { assetId })}
          />
        )}

        {kind === 'material.output' && (
          <>
            <p className="nfn-desc">Base surface — used for any pin you leave unconnected.</p>
            <label className="node-field">
              <span>Base Color</span>
              <input
                type="color"
                value={material.color}
                onChange={(event) => updateMaterial(material.id, { color: event.target.value })}
              />
            </label>
            <RangeField label="Metalness" value={material.metalness} onChange={(metalness) => updateMaterial(material.id, { metalness })} />
            <RangeField label="Roughness" value={material.roughness} onChange={(roughness) => updateMaterial(material.id, { roughness })} />
            <label className="node-field">
              <span>Emissive</span>
              <input
                type="color"
                value={material.emissiveColor}
                onChange={(event) => updateMaterial(material.id, { emissiveColor: event.target.value })}
              />
            </label>
            <RangeField
              label="Emissive Int"
              value={material.emissiveIntensity}
              min={0}
              max={5}
              step={0.05}
              onChange={(emissiveIntensity) => updateMaterial(material.id, { emissiveIntensity })}
            />
            <ImageSelect
              label="Base Texture"
              value={material.textureAssetId}
              imageAssets={imageAssets}
              onChange={(textureAssetId) =>
                updateMaterial(material.id, {
                  textureAssetId,
                  // A base-color map is multiplied by the flat Base Color. New/imported materials
                  // commonly start with a neutral editor tint, which makes PNGs look "wrong".
                  // When the user first assigns a texture to an untuned material, clear that tint.
                  ...(textureAssetId && ['#B4BCCC', '#5B8CFF'].includes(material.color.toUpperCase())
                    ? { color: '#ffffff' }
                    : {}),
                })
              }
            />
            <ImageSelect
              label="Normal Map"
              value={material.normalMapAssetId}
              imageAssets={imageAssets}
              onChange={(normalMapAssetId) => updateMaterial(material.id, { normalMapAssetId })}
            />
          </>
        )}
      </div>
    </aside>
  );
}

function MaterialFlow({ material }: { material: MaterialDefinition }) {
  const graphs = useEditorStore((state) => state.graphs);
  const selectedGraphNodeId = useEditorStore((state) => state.selectedGraphNodeId);
  const selectGraphNode = useEditorStore((state) => state.selectGraphNode);
  const onMaterialNodesChange = useEditorStore((state) => state.onMaterialNodesChange);
  const onMaterialEdgesChange = useEditorStore((state) => state.onMaterialEdgesChange);
  const onMaterialConnect = useEditorStore((state) => state.onMaterialConnect);
  const addMaterialNode = useEditorStore((state) => state.addMaterialNode);
  const autoLayoutMaterialGraph = useEditorStore((state) => state.autoLayoutMaterialGraph);
  const assets = useEditorStore((state) => state.assets);

  const graph = graphs.find((item) => item.id === material.graphId);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedGraphNodeId);

  const { screenToFlowPosition } = useReactFlow();
  const [searchMenu, setSearchMenu] = useState<{ x: number; y: number } | null>(null);

  const addNodeAt = (choice: NodeChoice, screen: { x: number; y: number }) => {
    const position = screenToFlowPosition({ x: screen.x, y: screen.y });
    const id = addMaterialNode(choice.nodeLabel ?? choice.label, choice.category, choice.data ?? {}, position);
    selectGraphNode(id);
    setSearchMenu(null);
  };

  if (!graph) {
    return <div className="empty-state wide">Preparing material graph…</div>;
  }

  return (
    <div className="scripting-body">
      <aside className="node-palette">
        <div className="blueprint-card">
          <strong>{material.name}</strong>
          <span>Wire nodes into Material Output to override the base surface.</span>
        </div>
        {paletteGroups.map(({ title, icon: Icon, nodes }) => (
          <PaletteGroup key={title} title={title} icon={Icon} count={nodes.length}>
            {nodes.map((node) => (
              <button key={node.key} onClick={() => selectGraphNode(addMaterialNode(node.key, 'Material'))} title={`Add ${node.label}`}>
                <Plus size={13} aria-hidden />
                <span>{node.label}</span>
              </button>
            ))}
          </PaletteGroup>
        ))}
      </aside>

      <div
        className="flow-shell"
        onClickCapture={(event) => {
          const nodeEl = (event.target as HTMLElement).closest('.react-flow__node');
          const id = nodeEl?.getAttribute('data-id');
          if (id) selectGraphNode(id);
        }}
        onContextMenuCapture={(event) => {
          event.preventDefault();
          setSearchMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onMaterialNodesChange}
          onEdgesChange={onMaterialEdgesChange}
          onConnect={onMaterialConnect}
          onNodeClick={(_, node) => selectGraphNode(node.id)}
          onPaneClick={() => {
            selectGraphNode(undefined);
            setSearchMenu(null);
          }}
          deleteKeyCode={['Delete', 'Backspace']}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          connectionLineStyle={{ stroke: '#3DD0DC', strokeWidth: 2 }}
          snapToGrid
          snapGrid={[24, 24]}
          fitView
        >
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls position="bottom-right" />
          <Background color="#30394D" gap={18} size={1} />
        </ReactFlow>
        <button
          className="icon-button compact material-autolayout"
          title="Auto-arrange nodes"
          onClick={autoLayoutMaterialGraph}
        >
          <LayoutGrid size={15} aria-hidden />
        </button>
      </div>

      <MaterialNodeInspector node={selectedNode} material={material} imageAssets={imageAssets} />

      {searchMenu && (
        <NodeSearchMenu
          x={searchMenu.x}
          y={searchMenu.y}
          choices={nodeChoices}
          onPick={(choice) => addNodeAt(choice, searchMenu)}
          onClose={() => setSearchMenu(null)}
        />
      )}
    </div>
  );
}

export function MaterialEditorPanel() {
  const materials = useEditorStore((state) => state.materials);
  const activeMaterialId = useEditorStore((state) => state.activeMaterialId);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const createMaterial = useEditorStore((state) => state.createMaterial);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const ensureMaterialGraph = useEditorStore((state) => state.ensureMaterialGraph);

  const material = materials.find((item) => item.id === activeMaterialId) ?? materials[0];

  // Older materials may predate the graph model — give them one when opened.
  useEffect(() => {
    if (material) ensureMaterialGraph(material.id);
  }, [material, ensureMaterialGraph]);

  return (
    <section className="panel material-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Surface</span>
          <h2>Material</h2>
        </div>
        {materials.length > 0 && (
          <select
            className="blueprint-select"
            value={material?.id ?? ''}
            onChange={(event) => setActiveMaterial(event.target.value)}
            title="Select material"
          >
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create material" onClick={() => createMaterial()}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {!material ? (
        <div className="empty-state wide">
          <Palette size={18} aria-hidden />
          <span>No material yet</span>
          <button className="full-button" onClick={() => createMaterial()}>
            Create Material
          </button>
        </div>
      ) : (
        <>
          <div className="material-preview">
            <Canvas shadows camera={{ position: [0, 0, 3.2], fov: 38 }}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[3, 4, 2]} intensity={1.1} />
              <Environment resolution={128}>
                <Lightformer intensity={1.1} position={[0, 4, 0]} scale={[8, 8, 1]} />
                <Lightformer intensity={0.6} position={[4, 2, 3]} scale={[5, 5, 1]} color="#8aa0ff" />
              </Environment>
              <Suspense fallback={null}>
                <MaterialPreview material={material} />
              </Suspense>
              <OrbitControls enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} />
            </Canvas>
          </div>
          <section className="material-preset-library" aria-label="Material presets">
            <div className="preset-library-head">
              <span>
                <Sparkles size={13} aria-hidden />
                Presets
              </span>
              <button
                className="text-button"
                onClick={() => {
                  for (const preset of MATERIAL_PRESETS) {
                    const id = createMaterial(preset.name, preset.description);
                    updateMaterial(id, { ...preset.patch, description: preset.description });
                  }
                }}
              >
                Create all
              </button>
            </div>
            <div className="preset-chip-grid">
              {MATERIAL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  title={preset.description}
                  onClick={() => updateMaterial(material.id, { ...preset.patch, description: preset.description })}
                >
                  <span className="preset-swatch" style={{ background: preset.patch.emissiveIntensity > 0 ? preset.patch.emissiveColor : preset.patch.color }} />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </section>
          {/* Own ReactFlowProvider so this graph's viewport/store stays isolated from the Scripting panel. */}
          <ReactFlowProvider>
            <MaterialFlow material={material} />
          </ReactFlowProvider>
        </>
      )}
    </section>
  );
}
