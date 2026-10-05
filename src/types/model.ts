import type { Vector3Tuple } from './common';

/**
 * Prototype models ("Model Forge").
 *
 * A model is stored as a SPEC — a flat-color palette plus a list of primitive parts — never as baked
 * geometry, exactly like trees. That keeps a placed prop at a few hundred bytes, lets one asset edit
 * restyle every placed instance at once, and means the whole thing round-trips through project saves
 * and .nfpack packages as plain JSON. When a prototype graduates, the spec can be baked into a real
 * GLB model asset through the ordinary import pipeline.
 */

/** Primitive vocabulary. Nine solids cover blockouts and decorative kit-bashing: five classics plus a
 *  torus (rings), pyramid (tents/roofs), hexagonal prism (nuts/columns) and capsule (pills/bottles).
 *  'mesh' is the editable-topology part: convert any primitive to a mesh to extrude faces, subdivide,
 *  or run booleans. Anything finer belongs in Blender and comes back as a GLB. */
export type ModelPartShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'wedge' | 'torus' | 'pyramid' | 'hexprism' | 'capsule' | 'mesh';

/**
 * Per-part collision override for a kit-bashed prop. 'auto' (or leaving it unset) derives the part's
 * collider from its shape: box → box, cylinder → capsule, sphere → sphere, cone → ball, wedge → box.
 * 'box'/'sphere'/'capsule' force that primitive collider (e.g. a sphere part can be a tight ball, a
 * thin plank a long box). 'none' removes the part from collision entirely (a purely visual knob, a
 * non-solid railing). When NO part carries an override, the whole prop keeps the Phase-1 exact treatment:
 * a trimesh on fixed bodies / one convex hull on dynamic bodies. When any part DOES, every part becomes
 * a compound primitive collider (auto parts derive a primitive too) so one per-part setting stays easy
 * to reason about.
 */
export type ModelPartCollider = 'auto' | 'box' | 'sphere' | 'capsule' | 'none';

export interface ModelPart {
  id: string;
  name: string;
  shape: ModelPartShape;
  /** Local offset inside the model, world units. */
  position: Vector3Tuple;
  /** Radians, matching TransformComponent. */
  rotation: Vector3Tuple;
  /** World-unit dimensions — parts use unit geometry, so scale IS the size. */
  scale: Vector3Tuple;
  /** Palette slot painting the whole part. */
  colorSlot: number;
  /** Per-part collision override. Undefined = 'auto' (derive from shape). */
  collider?: ModelPartCollider;
  /**
   * Per-face paint: geometry material-group index → palette slot (a box has 6 groups, a cylinder
   * side/top/bottom, …). Absent faces fall back to `colorSlot`.
   */
  faceColors?: Record<number, number>;
  /**
   * Vertex editing (box parts): unit-space offsets per corner, keyed by corner index
   * bit0=+X, bit1=+Y, bit2=+Z (0 = left-bottom-back … 7 = right-top-front). The whole hull —
   * including a smooth bevel — deforms trilinearly through the 8 corners, so a box can become a
   * roof peak, a tapered pillar or a leaning rock while staying a tiny serialized spec.
   */
  corners?: Record<number, Vector3Tuple>;
  /**
   * Full editable-mesh payload (shape 'mesh'). Explicit unit-space vertices + triangles; `scale`
   * multiplies at render just like primitive parts. Convert any part to a mesh to pierce a hole,
   * extrude a tab, or run boolean unions/subtractions — the model stays live-linked and linkable,
   * physics trimeshes it exactly, and GLB baking just works.
   */
  mesh?: ModelPartMesh;
  /**
   * Non-destructive modifier stack (mesh parts), evaluated in order at render/bake/physics time:
   * mirror, array and subdivision surface. The stored cage never changes, so a modifier can be
   * toggled, reordered or removed at any time — the Blender modifier-stack contract.
   */
  modifiers?: ModelModifier[];
  /**
   * Auto-smooth angle in degrees for mesh parts: edges whose faces meet at a sharper angle render
   * hard, everything shallower shades smooth. 0 = fully faceted, 180 = fully smooth. Undefined
   * derives from the model finish (smooth → 40°, flat → 0°).
   */
  smoothAngle?: number;
  /** Engine material override (project `materials` library id). Textured parts use the mesh UVs. */
  materialId?: string;
  /** Outliner group label. Parts sharing a label select, hide and move together in the Forge. */
  group?: string;
}

/** One entry of a mesh part's non-destructive modifier stack. `enabled: false` keeps it but skips it. */
export type ModelModifier =
  | {
      type: 'mirror';
      enabled?: boolean;
      /** Mirror across the part's local X/Y/Z = 0 plane. Several axes may be combined. */
      axes: Array<'x' | 'y' | 'z'>;
      /** Weld seam vertices lying on the mirror plane (within this distance, unit space). */
      mergeDistance?: number;
    }
  | {
      type: 'array';
      enabled?: boolean;
      /** Total copies, including the original (2-64). */
      count: number;
      /** 'linear' steps by `offset`; 'radial' rotates copies evenly around `axis` through the origin. */
      mode: 'linear' | 'radial';
      /** Linear step between copies, unit space. */
      offset?: Vector3Tuple;
      axis?: 'x' | 'y' | 'z';
      /** Radial sweep in degrees (360 = full ring). */
      angle?: number;
    }
  | {
      type: 'subdivision';
      enabled?: boolean;
      /** Catmull-Clark levels, 1-4 (render cost grows 4x per level). */
      levels: number;
    };

/**
 * A hand-edited mesh part. Vertices are stored in unit space (a cube is the eight ±0.5 corners) and
 * scaled by the part's `scale`, so a mesh part behaves exactly like a primitive with most vertices
 * controllable. `indices` is a flat triangle list (length divisible by 3).
 */
export interface ModelPartMesh {
  vertices: Vector3Tuple[];
  /** Triangulation of `faces` — always derived on normalization; kept for physics, CSG and old saves. */
  indices: number[];
  /**
   * The editable topology: polygons (quads, triangles, n-gons) as CCW vertex loops seen from outside.
   * This is the source of truth for every edit tool — loop cuts, insets, bevels and subdivision need
   * real quads and shared edges, which a triangle list cannot express. Older saves carry only
   * `indices`; normalization rebuilds faces from them by merging coplanar triangle pairs into quads.
   */
  faces?: number[][];
  /** Palette slot per face (parallel to `faces`); -1 or missing = the part's `colorSlot`. */
  faceSlots?: number[];
  /** UVs per face corner (parallel to `faces`, each entry parallel to that face's loop). */
  faceUVs?: Array<Array<[number, number]>>;
  /** Edges marked sharp (always hard-shaded, and kept crisp by subdivision), as vertex pairs. */
  sharpEdges?: Array<[number, number]>;
}

/**
 * The whole-model finish. 'smooth' is the Spline look — rounded box corners, smooth shading and a
 * subtle satin clearcoat over the same solid palette colors; 'flat' is the crisp faceted Meshy
 * look. One switch restyles the prop and every placed instance.
 */
export interface ModelStyle {
  finish: 'flat' | 'smooth';
  /** World-unit corner radius on box parts. Applied only under the 'smooth' finish. */
  bevel: number;
  /** Material roughness (0.05-1); lower reads glossier. */
  roughness: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  /** Flat stylized color palette (hex strings). Parts and faces reference slots by index. */
  palette: string[];
  parts: ModelPart[];
  /** Optional in stored data (older saves); normalization always backfills it. */
  style?: ModelStyle;
}

/**
 * A prototype model placed in a scene (on a `kind: 'empty'` object, like trees).
 *
 * `specId` resolves against the project's model library LIVE — editing the asset in the Model Forge
 * restyles every placed instance at once. The inline `spec` exists only as the keep-alive copy
 * stamped in when the library entry is deleted, so placed props never lose their geometry.
 */
export interface ModelComponent {
  enabled: boolean;
  /** Library asset id (src/store/editorStore.ts `modelSpecs`). */
  specId?: string;
  /** Inline fallback, present only after the library entry was deleted. */
  spec?: ModelSpec;
}

/** Axis name used by mirror/symmetry tools. */
export type ModelAxis = 'x' | 'y' | 'z';

/**
 * One Blender-style edit on a mesh part's polygon cage. Every edit path — the Forge's Edit mode, the
 * plugin API and the AI tools — goes through this single union (store `applyModelMeshOp`), so each
 * op is one undo step and behaves identically wherever it came from. Indices refer to the part's
 * CURRENT cage: faces index `mesh.faces`, vertices index `mesh.vertices`, edges are vertex pairs.
 */
export type ModelMeshOp =
  | { type: 'extrude'; faces: number[]; distance?: number; individual?: boolean }
  | { type: 'inset'; faces: number[]; thickness?: number; depth?: number; individual?: boolean }
  | { type: 'bevel'; edges: Array<[number, number]>; width?: number; segments?: number }
  | { type: 'loopCut'; edge: [number, number]; cuts?: number; factor?: number }
  | { type: 'subdivide'; faces: number[]; cuts?: number }
  | { type: 'merge'; vertices: number[]; mode?: 'center' | 'first' | 'last' }
  | { type: 'delete'; faces?: number[]; vertices?: number[] }
  | { type: 'dissolveEdges'; edges: Array<[number, number]> }
  | { type: 'flip'; faces: number[] }
  | { type: 'recalculateNormals' }
  | { type: 'fill'; vertices: number[] }
  | { type: 'weld'; distance?: number }
  | { type: 'mirror'; axis: ModelAxis; mergeDistance?: number }
  | { type: 'applyModifiers' }
  | { type: 'moveVertices'; deltas: Array<[number, Vector3Tuple]>; symmetry?: ModelAxis[] }
  | { type: 'setVertices'; positions: Array<[number, Vector3Tuple]> }
  | { type: 'paintFaces'; faces: number[]; slot: number }
  | { type: 'markSharp'; edges: Array<[number, number]>; sharp: boolean }
  | { type: 'unwrap'; method: 'box' | 'smart' | 'planar' | 'cylinder' | 'sphere'; axis?: ModelAxis; tiling?: number }
  /** Knife: split `faces` along a plane (unit space); neighbours gain the cut vertices so nothing cracks. */
  | { type: 'knife'; plane: { point: Vector3Tuple; normal: Vector3Tuple }; faces: number[] }
  /** Bisect: cut the whole mesh (or `faces`) with a plane; optionally delete one side and fill the cut. */
  | { type: 'bisect'; plane: { point: Vector3Tuple; normal: Vector3Tuple }; faces?: number[]; clear?: 'none' | 'inner' | 'outer'; fill?: boolean };

/** What an op selected afterwards (Blender keeps the new geometry selected, e.g. extruded caps). */
export interface ModelMeshOpResult {
  ok: boolean;
  message?: string;
  faces?: number[];
  edges?: Array<[number, number]>;
  vertices?: number[];
}

/** Clean-topology mesh builders for new mesh parts (lathe a vase, sweep a pipe, quad primitives). */
export type ModelMeshGenerator =
  | { kind: 'primitive'; shape: Exclude<ModelPartShape, 'mesh'> }
  | { kind: 'cube'; segments?: number }
  | { kind: 'plane'; segmentsX?: number; segmentsZ?: number }
  | { kind: 'cylinder'; sides?: number; heightSegments?: number }
  | { kind: 'sphere'; segments?: number; rings?: number }
  | { kind: 'torus'; majorSegments?: number; minorSegments?: number; minorRatio?: number }
  | { kind: 'lathe'; profile: Array<[number, number]>; segments?: number; angle?: number; capEnds?: boolean }
  | { kind: 'tube'; path: Vector3Tuple[]; radius?: number; sides?: number; closed?: boolean };
