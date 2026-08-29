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
}

/**
 * A hand-edited mesh part. Vertices are stored in unit space (a cube is the eight ±0.5 corners) and
 * scaled by the part's `scale`, so a mesh part behaves exactly like a primitive with most vertices
 * controllable. `indices` is a flat triangle list (length divisible by 3).
 */
export interface ModelPartMesh {
  vertices: Vector3Tuple[];
  indices: number[];
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
