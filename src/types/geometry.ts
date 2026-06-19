import type { SceneObjectKind, Vector3Tuple } from './common';

export interface TransformComponent {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface MeshRendererComponent {
  enabled: boolean;
  mesh: Exclude<SceneObjectKind, 'empty' | 'terrain' | 'light' | 'camera'>;
  color: string;
  metalness: number;
  roughness: number;
  /** Surface opacity 0–1 (1 = fully opaque, the default). Below 1 renders the mesh translucent — used for
   *  water/glass volumes. Applies to built-in meshes; models honor it when `overrideMaterial` is on. */
  opacity?: number;
  /** Hide this object's renderer while Play/runtime is running. Editor view still shows it for authoring. */
  hideInPlay?: boolean;
  /** When set, render this imported glTF/GLB model asset instead of the built-in `mesh`. */
  modelAssetId?: string;
  /** Image asset used as the base-color (albedo) map — applies to built-in meshes and models. */
  textureAssetId?: string;
  /** For model assets: when true, the color/metalness/roughness below override the model's baked materials. */
  overrideMaterial?: boolean;
  /** When set, a reusable MaterialDefinition supplies this object's surface (overrides the inline props above and a model's baked materials). */
  materialId?: string;
  /** Per-slot material overrides for an imported model, indexed by the model's material-slot order (the
   *  same order `inspectModel` reports). Each entry is a MaterialDefinition id, or undefined to keep that
   *  slot's baked material. Takes precedence over `materialId` (which acts as a whole-model fallback). */
  materialSlots?: (string | undefined)[];
  /** Per-object tweaks applied on top of the assigned material — written by runtime "Set Material" nodes, never mutating the shared definition. */
  materialOverrides?: MaterialOverrides;
  /** Runtime-only: a key into the raw-geometry cache for a spawned fracture shard — the renderer draws
   *  this raw mesh instead of a built-in primitive or model. Never serialized (shards are transient). */
  fragmentKey?: string;
}

export type TerrainFoliageMode = 'grass' | 'trees' | 'mixed';
export type TerrainGrassMeshStyle = 'blade' | 'cross' | 'tuft';
export type TerrainTreeMeshStyle = 'cone' | 'round';
/** Where a foliage instance's mesh comes from: engine primitive, a 2D image billboard, or a 3D model asset. */
export type TerrainFoliageSource = 'builtin' | 'image' | 'model';

export interface TerrainMaterialLayer {
  id: string;
  name: string;
  color: string;
  textureAssetId?: string;
  normalMapAssetId?: string;
}

export type TerrainSculptOperation = 'raise' | 'lower' | 'flatten' | 'smooth';
export type TerrainBrushMode = 'sculpt' | 'paint' | 'foliage';

export interface TerrainBrushSettings {
  enabled: boolean;
  objectId?: string;
  mode: TerrainBrushMode;
  operation: TerrainSculptOperation;
  radius: number;
  strength: number;
  targetLayerId?: string;
  flattenHeight: number;
  /** Foliage brush: paint density 0..1 written into the foliage mask (the brushed area's grass amount). */
  foliageDensity?: number;
  /** Foliage brush: erase painted foliage instead of adding it. */
  foliageErase?: boolean;
}

/** Procedural foliage scattered on terrain chunks. MVP intentionally uses built-in instanced shapes. */
export interface TerrainFoliageComponent {
  enabled: boolean;
  mode: TerrainFoliageMode;
  /** Relative density 0..1. Grass/shrub instances per chunk scale from this value. */
  density: number;
  /** Relative density 0..1 for sparse tree instances. */
  treeDensity: number;
  minScale: number;
  maxScale: number;
  /** Minimum terrain normal Y allowed for placement. Higher avoids steep slopes. */
  slopeLimit: number;
  grassMesh: TerrainGrassMeshStyle;
  treeMesh: TerrainTreeMeshStyle;
  /** Mesh source for grass: 'builtin' high-quality wind-animated blades, 'image' 2D billboard, or 'model'. */
  grassSource?: TerrainFoliageSource;
  /** Mesh source for trees: 'builtin', 'image' 2D billboard, or 'model'. */
  treeSource?: TerrainFoliageSource;
  /** Optional model assets override the built-in foliage mesh for previewable custom vegetation. */
  grassModelAssetId?: string;
  treeModelAssetId?: string;
  /** Image (texture) assets for the 'image' 2D-billboard source (alpha-cutout cross quads). */
  grassImageAssetId?: string;
  treeImageAssetId?: string;
  grassColor: string;
  trunkColor: string;
  treeColor: string;
  /** Multiplier on the global scene wind for foliage sway (0 = stiff/no sway, the blades just stand). */
  windStrength?: number;
  /**
   * When true, grass/trees scatter ONLY where painted (the terrain's foliageOverrides mask) instead of
   * uniformly by density — the Unreal-style hand-painted foliage workflow. The foliage paint brush flips
   * this on the first stroke; turn it off to go back to uniform `density` coverage everywhere.
   */
  usePaintMask?: boolean;
}

/**
 * A procedural, chunk-streamed terrain surface. Stored as compact settings rather than a huge
 * height array so projects/export bundles stay small and the same world can be rebuilt deterministically.
 */
export interface TerrainComponent {
  enabled: boolean;
  /** Total authored terrain width/depth in world units. */
  size: number;
  /** Width/depth of one streamed render/physics chunk. */
  chunkSize: number;
  /** Segments per chunk edge. Higher = more detail and more vertices/collider samples. */
  resolution: number;
  /** Render chunks around the camera/player in this many chunk rings. */
  streamRadius: number;
  /** Physics chunks around active characters/dynamic bodies in this many chunk rings. */
  physicsRadius: number;
  /** Deterministic seed for height/noise/foliage scatter. */
  seed: number;
  heightScale: number;
  frequency: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  /** World-space distance between persistent sculpt/paint samples. */
  editSpacing: number;
  lowColor: string;
  midColor: string;
  highColor: string;
  /** Paintable terrain material layers. The first three backfill low/mid/high terrain colors. */
  materialLayers: TerrainMaterialLayer[];
  /** Sparse absolute height overrides keyed as "gridX:gridZ". */
  heightOverrides: Record<string, number>;
  /** Sparse material-layer paint overrides keyed as "gridX:gridZ", value = TerrainMaterialLayer.id. */
  paintOverrides: Record<string, string>;
  /** Sparse hand-painted foliage density mask keyed as "gridX:gridZ", value 0..1 (used when foliage.usePaintMask). */
  foliageOverrides?: Record<string, number>;
  foliage: TerrainFoliageComponent;
  /**
   * Bumped on every terrain edit (sculpt/paint/settings/foliage). The viewport's structural signature
   * watches this so live edits re-render immediately — without it, edits only showed after toggling the
   * terrain off/on (the signature couldn't see value-level changes inside the sparse override maps).
   */
  editVersion?: number;
}

/**
 * Advanced MeshPhysicalMaterial surface layers, on top of the base metal/rough PBR. All optional and
 * default to neutral (0 / ior 1.5) so a material without them renders exactly like the old
 * MeshStandardMaterial. Fully honored on built-in meshes and on imported models whose material is
 * physical (PBR glass/car/gem GLBs); ignored on plain MeshStandardMaterial model slots.
 */
export interface PhysicalSurfaceProps {
  /** Clear lacquer layer on top of the base — car paint, varnished wood, polished plastic. 0–1. */
  clearcoat?: number;
  /** Roughness of that clearcoat layer (0 = mirror-sharp coat, 1 = satin). */
  clearcoatRoughness?: number;
  /** Retroreflective fabric sheen — velvet, satin, brushed cloth. 0–1. */
  sheen?: number;
  /** Tint of the fabric sheen highlight (hex). */
  sheenColor?: string;
  /** Light transmitted THROUGH the surface — real glass, water, gems, liquids. 0–1. Pair with ior/thickness. */
  transmission?: number;
  /** Index of refraction for transmission/reflections (1.0 air … 1.33 water … 1.5 glass … 2.4 diamond). */
  ior?: number;
  /** Volume thickness for refraction bending (world units); 0 = thin shell, higher = chunky glass/gem. */
  thickness?: number;
  /** Thin-film iridescence — soap bubbles, oil slicks, beetle shells. 0–1. */
  iridescence?: number;
}

/** Per-object overrides layered over an assigned MaterialDefinition (Unreal "dynamic material instance" style). */
export interface MaterialOverrides extends PhysicalSurfaceProps {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

/** A reusable material asset authored once and assigned to many objects. */
export interface MaterialDefinition extends PhysicalSurfaceProps {
  id: string;
  name: string;
  description: string;
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  /** Base-color (albedo) map — an "image"-type asset id. */
  textureAssetId?: string;
  /** Normal map — an "image"-type asset id. */
  normalMapAssetId?: string;
  /** Optional node graph (in `graphs`) whose Material Output pins override the flat fields above. */
  graphId?: string;
  /** The model asset this material was extracted from on import (lets a placed model auto-link it). */
  sourceAssetId?: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

