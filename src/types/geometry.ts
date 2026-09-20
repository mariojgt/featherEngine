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
/** `clump` is the stylized painted-card grass (the default look); the others are the legacy simple shapes. */
export type TerrainGrassMeshStyle = 'clump' | 'blade' | 'cross' | 'tuft';
/** How grass dissolves as it approaches the render distance. */
export type GrassFadeMode = 'off' | 'smooth' | 'dither';

/**
 * The stylized-grass look. Grouped exactly like a dedicated grass shader's material so the mental model
 * transfers: a master tint (the foliage `grassColor`), a root->tip gradient over it, world-space colour
 * variation, wind, bend/perspective shaping, actor interaction, and distance fade.
 */
export interface StylizedGrassSettings {
  /** Tip colour of the vertical gradient — multiplies the grass tint. */
  gradientTop: string;
  /** Root colour of the vertical gradient. Dark values give grass its planted, self-shadowed base. */
  gradientBottom: string;
  /** 0..1 — slides where the dark root ends and the gradient starts climbing. */
  gradientOffset: number;
  /** 0..1 — 0 is a soft blend, 1 squeezes the gradient into a hard two-tone band. */
  gradientContrast: number;
  /** World-space frequency of the patch-to-patch colour variation (smaller = broader patches). */
  colorNoiseScale: number;
  /** 0..1 — how strongly the variation tints the grass. 0 disables it. */
  colorNoiseStrength: number;
  colorNoiseLow: string;
  colorNoiseHigh: string;
  /** How fast the wind gust pattern scrolls across the field. */
  windSpeed: number;
  /** World-space frequency of the wind gust noise (smaller = longer, rolling gust fronts). */
  windNoiseScale: number;
  /** 0..1 blade height at which bending starts — below it the clump stays rooted. */
  bendPivot: number;
  /** 0..1 — how far tips lean toward the camera as the view angle steepens (keeps top-down views full). */
  perspectiveCorrection: number;
  /** 0..1 blade height at which perspective correction starts. */
  perspectiveHeightStart: number;
  /** How far actors shove grass aside, in world units. */
  interactionStrength: number;
  /** How far actors mash grass downward, in world units. */
  pushDownAmount: number;
  /** Colour multiplier applied to grass currently bent by an actor, so trodden paths stay readable. */
  trailTint: string;
  /** 0..1 — how far the shading normal leans toward world up. High values light grass like soft turf. */
  normalLift: number;
  fadeMode: GrassFadeMode;
  /** Distance (world units) where the fade begins. */
  fadeStart: number;
  /** Distance where grass is fully gone. */
  fadeEnd: number;
}
export type TerrainTreeMeshStyle = 'cone' | 'round' | 'fir';
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
  /** Master tint for grass. With the `clump` mesh style the gradient and variation multiply over this. */
  grassColor: string;
  trunkColor: string;
  treeColor: string;
  /**
   * Scatter a parametric tree ASSET from the project's tree library instead of the built-in cone/fir
   * crowns. Editing that asset in the Tree Builder restyles every scattered tree at once.
   * Requires treeSource 'builtin'. Empty/undefined falls back to the simple built-in crowns.
   */
  treeSpecId?: string;
  /** Look/motion settings for the stylized `clump` grass. Ignored by the other grass mesh styles. */
  stylizedGrass?: StylizedGrassSettings;
  /** Multiplier on the global scene wind for foliage sway (0 = stiff/no sway, the blades just stand). */
  windStrength?: number;
  /**
   * How strongly grass/flowers part and flatten around a passing player or actor during Play (BOTW-style).
   * 1 = natural, 0 = ignores actors, >1 = exaggerated. Undefined defaults to 1 (interaction on).
   */
  interactStrength?: number;
  /**
   * Wildflower density scattered through the grass, 0..1. Small brightly-colored blooms (varied red/
   * yellow/white/purple/pink) mixed among the blades — they wind-sway and part around the player like the
   * grass. 0/undefined = no flowers. Only appears where grass does (grass/mixed mode).
   */
  flowerDensity?: number;
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
  /** Blend rolling hills into sharp mountain ridges (0..1). Omitted preserves legacy terrain. */
  ridgeStrength?: number;
  /** Low-frequency domain warp in world units; breaks up the noise grid without seams. */
  domainWarp?: number;
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

/** Toon/cel finish preset — chooses the tonal ramp (and rim behaviour) for a toon material. */
export type ToonFinish = 'flat' | 'jelly' | 'metal' | 'rubber' | 'pearl' | 'hair' | 'cloth';

/**
 * Stylized TOON / cel-shading surface (built on THREE.MeshToonMaterial). Mutually exclusive with the
 * PBR physical layers above — when `toon` is on, the render sites emit a toon material and ignore
 * clearcoat/transmission/etc. Ported from the sibling three.js game's cartoon material factory.
 */
export interface ToonSurfaceProps {
  /** Master switch: render this surface as cel-shaded rather than physically-based. */
  toon?: boolean;
  /** Number of tonal plateaus in the ramp (2–6); higher = smoother gradient. Ignored by non-flat finishes. */
  toonBands?: number;
  /** Finish ramp: flat/jelly are gradient-band looks; metal/rubber/pearl/hair/cloth use tuned ramps. */
  toonFinish?: ToonFinish;
  /** Fresnel rim (candy edge) colour (hex). */
  toonRimColor?: string;
  /** Fresnel rim strength, 0 = no rim … ~0.3 strong edge light. */
  toonRimStrength?: number;
}

/** Per-object overrides layered over an assigned MaterialDefinition (Unreal "dynamic material instance" style). */
export interface MaterialOverrides extends PhysicalSurfaceProps, ToonSurfaceProps {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

/** A reusable material asset authored once and assigned to many objects. */
export interface MaterialDefinition extends PhysicalSurfaceProps, ToonSurfaceProps {
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
