import type { ModelPartMesh } from '../types';
import {
  MAX_MESH_FACES,
  MAX_MESH_VERTICES,
  add3,
  buildTopology,
  cross3,
  dot3,
  edgeKey,
  ensurePolyMesh,
  length3,
  lerp3,
  makePolyMesh,
  normalize3,
  polygonNormal,
  scale3,
  sub3,
  type MeshTopology,
  type Vec3,
} from './polyMesh';

/**
 * Blender-style edit-mode operators for Model Forge mesh parts. Pure data in, pure data out: no
 * three.js, no store, inputs are never mutated.
 *
 * Every topology op starts from `ensurePolyMesh` (so triangle-only payloads work), edits a working
 * copy of vertices + polygon loops + per-face attributes, then leaves through `makePolyMesh` so the
 * triangulation is always re-derived. Ops return a `MeshOpResult` whose `faces` / `edges` /
 * `vertices` are the selection the editor should switch to afterwards (Blender behaviour: after an
 * extrude the new caps are selected, after a loop cut the new loop is). Face indices in a result
 * refer to the returned mesh; vertex indices are already remapped through compaction.
 *
 * Attribute carry: surviving faces keep their `faceSlots` / `faceUVs`; new faces inherit the slot of
 * the face they grew from. Ops that cannot produce sensible UVs for new faces drop `faceUVs`
 * entirely so the UV module re-unwraps. Sharp edges survive while their edge still exists.
 *
 * When an op would exceed MAX_MESH_VERTICES / MAX_MESH_FACES the input mesh is returned unchanged.
 */

export type MeshAxis = 'x' | 'y' | 'z';
export type ProportionalFalloff = 'smooth' | 'sphere' | 'root' | 'linear' | 'sharp' | 'constant';
export type MeshEdge = [number, number];
type UV = [number, number];

export interface MeshOpResult {
  mesh: ModelPartMesh;
  /** Faces to select afterwards (indices into `mesh.faces`). */
  faces?: number[];
  /** Edges to select afterwards, as [min, max] vertex pairs. */
  edges?: MeshEdge[];
  /** Vertices to select afterwards. */
  vertices?: number[];
}

const AXIS_INDEX: Record<MeshAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

// ------------------------------------------------------------------------------------------------
// Working copy
// ------------------------------------------------------------------------------------------------

interface Work {
  vertices: Vec3[];
  faces: number[][];
  slots: number[];
  /** Per-face corner UVs; set to undefined as soon as a face without UVs is added. */
  uvs: UV[][] | undefined;
  sharp: MeshEdge[] | undefined;
}

function begin(mesh: ModelPartMesh): Work {
  const poly = ensurePolyMesh(mesh);
  const faces = (poly.faces ?? []).map((loop) => [...loop]);
  return {
    vertices: [...poly.vertices],
    faces,
    slots: faces.map((_, index) => poly.faceSlots?.[index] ?? -1),
    uvs:
      poly.faceUVs && poly.faceUVs.length === faces.length
        ? poly.faceUVs.map((corners) => corners.map((uv) => [uv[0], uv[1]] as UV))
        : undefined,
    sharp: poly.sharpEdges?.map(([a, b]) => [a, b] as MeshEdge),
  };
}

function addVertex(work: Work, position: readonly number[]): number {
  work.vertices.push([position[0], position[1], position[2]]);
  return work.vertices.length - 1;
}

function addFace(work: Work, loop: number[], slot: number, uv?: UV[]): number {
  work.faces.push(loop);
  work.slots.push(slot);
  if (work.uvs) {
    if (uv && uv.length === loop.length) work.uvs.push(uv);
    else work.uvs = undefined;
  }
  return work.faces.length - 1;
}

/**
 * Compact unused vertices (keeping the original order, so untouched indices stay stable when
 * nothing was removed), drop sharp edges that no longer exist and build the payload. Returns null
 * when the result would exceed the mesh limits.
 */
function finish(work: Work): { mesh: ModelPartMesh; remap: Int32Array } | null {
  if (work.vertices.length > MAX_MESH_VERTICES || work.faces.length > MAX_MESH_FACES) return null;
  const used = new Uint8Array(work.vertices.length);
  for (const loop of work.faces) for (const v of loop) used[v] = 1;
  const remap = new Int32Array(work.vertices.length).fill(-1);
  const vertices: Vec3[] = [];
  for (let i = 0; i < work.vertices.length; i += 1) {
    if (!used[i]) continue;
    remap[i] = vertices.length;
    vertices.push(work.vertices[i]);
  }
  const faces = work.faces.map((loop) => loop.map((v) => remap[v]));
  const existing = new Set<number>();
  for (const loop of faces) for (let i = 0; i < loop.length; i += 1) existing.add(edgeKey(loop[i], loop[(i + 1) % loop.length]));
  const sharpEdges = work.sharp
    ?.map(([a, b]) => [remap[a] ?? -1, remap[b] ?? -1] as MeshEdge)
    .filter(([a, b]) => a >= 0 && b >= 0 && a !== b && existing.has(edgeKey(a, b)));
  const mesh = makePolyMesh(vertices, faces, {
    faceSlots: work.slots,
    faceUVs: work.uvs && work.uvs.length === faces.length ? work.uvs : undefined,
    sharpEdges,
  });
  return { mesh, remap };
}

function complete(
  input: ModelPartMesh,
  work: Work,
  select: { faces?: number[]; edges?: MeshEdge[]; vertices?: number[] } = {},
): MeshOpResult {
  const done = finish(work);
  if (!done) return { mesh: input };
  const { remap } = done;
  const result: MeshOpResult = { mesh: done.mesh };
  if (select.faces) result.faces = [...new Set(select.faces)];
  if (select.vertices) result.vertices = uniqueSorted(select.vertices.map((v) => remap[v] ?? -1).filter((v) => v >= 0));
  if (select.edges) {
    const seen = new Set<number>();
    result.edges = [];
    for (const [a, b] of select.edges) {
      const ra = remap[a] ?? -1;
      const rb = remap[b] ?? -1;
      if (ra < 0 || rb < 0 || ra === rb || seen.has(edgeKey(ra, rb))) continue;
      seen.add(edgeKey(ra, rb));
      result.edges.push(ra < rb ? [ra, rb] : [rb, ra]);
    }
  }
  return result;
}

const uniqueSorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);
const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
const lerpUV = (a: UV, b: UV, t: number): UV => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const validFaces = (work: Work, faces: Iterable<number>): number[] =>
  uniqueSorted([...faces].filter((f) => Number.isInteger(f) && f >= 0 && f < work.faces.length));
const validVerts = (mesh: ModelPartMesh, verts: Iterable<number>): number[] =>
  uniqueSorted([...verts].filter((v) => Number.isInteger(v) && v >= 0 && v < mesh.vertices.length));

function edgeId(topo: MeshTopology, a: number, b: number): number | undefined {
  return topo.edgeIndex.get(edgeKey(a, b));
}

/** Does face `loop` traverse a → b (as opposed to b → a)? */
function hasDirected(loop: readonly number[], a: number, b: number): boolean {
  const i = loop.indexOf(a);
  return i >= 0 && loop[(i + 1) % loop.length] === b;
}

/** Edge-connected components of a face set: the "regions" region-extrude and region-inset act on. */
function faceRegions(topo: MeshTopology, faces: readonly number[]): number[][] {
  const inSet = new Set(faces);
  const seen = new Set<number>();
  const regions: number[][] = [];
  for (const start of faces) {
    if (seen.has(start)) continue;
    const region: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const f = queue.pop()!;
      region.push(f);
      for (const e of topo.faceEdges[f]) {
        for (const g of topo.edgeFaces[e]) {
          if (inSet.has(g) && !seen.has(g)) {
            seen.add(g);
            queue.push(g);
          }
        }
      }
    }
    regions.push(region.sort((a, b) => a - b));
  }
  return regions;
}

/**
 * Splits recorded per edge (new vertex ids ordered from the lower vertex index to the higher, with
 * their parameter along that direction). Inserting them into every face that uses the edge is what
 * keeps loop cuts / subdivisions watertight: neighbours become n-gons instead of T-junctions.
 */
interface EdgeSplit {
  min: number;
  ids: number[];
  ts: number[];
}

function insertSplits(work: Work, splits: Map<number, EdgeSplit>, skip: Set<number>): void {
  if (!splits.size) return;
  work.faces.forEach((loop, f) => {
    if (skip.has(f)) return;
    const uv = work.uvs?.[f];
    const out: number[] = [];
    const outUV: UV[] = [];
    let changed = false;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      if (uv) outUV.push(uv[i]);
      const split = splits.get(edgeKey(a, b));
      if (!split) continue;
      changed = true;
      const forward = a === split.min;
      for (let k = 0; k < split.ids.length; k += 1) {
        const index = forward ? k : split.ids.length - 1 - k;
        out.push(split.ids[index]);
        if (uv) outUV.push(lerpUV(uv[i], uv[(i + 1) % loop.length], forward ? split.ts[index] : 1 - split.ts[index]));
      }
    }
    if (!changed) return;
    work.faces[f] = out;
    if (work.uvs && uv) work.uvs[f] = outUV;
  });
}

/** Insert arc/polyline points into any face that still carries the straight chord a–b. */
function insertPolylines(work: Work, polylines: Map<number, number[]>, skip: Set<number>): void {
  work.faces.forEach((loop, f) => {
    if (skip.has(f)) return;
    const out: number[] = [];
    let changed = false;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const line = polylines.get(edgeKey(a, b));
      if (!line || line.length <= 2) continue;
      changed = true;
      const ordered = line[0] === a ? line : [...line].reverse();
      for (let k = 1; k < ordered.length - 1; k += 1) out.push(ordered[k]);
    }
    if (changed) work.faces[f] = out;
  });
  if (work.uvs) work.uvs = work.uvs.every((uv, f) => uv.length === work.faces[f].length) ? work.uvs : undefined;
}

/**
 * Faces around vertex `v` in winding order (each next face shares the outgoing edge of the
 * previous one). Null unless `v` is an interior manifold vertex with consistent winding — the
 * precondition for bevel corner patches.
 */
function orderedFan(faces: number[][], topo: MeshTopology, v: number): number[] | null {
  const around = topo.vertexFaces[v];
  if (!around?.length) return null;
  for (const e of topo.vertexEdges[v]) if (topo.edgeFaces[e].length !== 2) return null;
  const order = [around[0]];
  let f = around[0];
  for (let guard = 0; guard <= around.length; guard += 1) {
    const loop = faces[f];
    const i = loop.indexOf(v);
    const n = loop[(i + 1) % loop.length];
    const e = edgeId(topo, v, n);
    if (e === undefined) return null;
    const pair = topo.edgeFaces[e];
    const g = pair[0] === f ? pair[1] : pair[0];
    if (!hasDirected(faces[g], n, v)) return null;
    if (g === order[0]) break;
    if (order.includes(g)) return null;
    order.push(g);
    f = g;
  }
  return order.length === around.length ? order : null;
}

// ------------------------------------------------------------------------------------------------
// Extrude
// ------------------------------------------------------------------------------------------------

/**
 * Offset for a vertex shared by faces with the given normals: along their average, lengthened so
 * every adjacent face plane moves by exactly `distance` (a flat region moves `distance`, a cube
 * corner moves `distance` along each face normal).
 */
function shellOffset(normals: Vec3[], distance: number): Vec3 {
  const unique: Vec3[] = [];
  for (const n of normals) if (!unique.some((u) => dot3(u, n) > 1 - 1e-6)) unique.push(n);
  let dir = normalize3(unique.reduce((sum, n) => add3(sum, n), [0, 0, 0] as Vec3));
  if (length3(dir) < 0.5) dir = unique[0] ?? [0, 0, 0];
  const meanDot = unique.reduce((sum, n) => sum + dot3(dir, n), 0) / Math.max(1, unique.length);
  return scale3(dir, distance / Math.max(meanDot, 0.25));
}

function extrudeRegions(mesh: ModelPartMesh, faceIndices: readonly number[], distance: number, individual: boolean): MeshOpResult {
  const work = begin(mesh);
  const selected = validFaces(work, faceIndices);
  if (!selected.length || !Number.isFinite(distance)) return { mesh, faces: [] };
  const topo = buildTopology(work);
  const normals = new Map<number, Vec3>();
  for (const f of selected) normals.set(f, polygonNormal(work.vertices, work.faces[f]));
  const regions = individual ? selected.map((f) => [f]) : faceRegions(topo, selected);
  const newVertices: number[] = [];
  for (const region of regions) {
    const inRegion = new Set(region);
    const vertexNormals = new Map<number, Vec3[]>();
    for (const f of region) {
      for (const v of work.faces[f]) {
        const list = vertexNormals.get(v);
        if (list) list.push(normals.get(f)!);
        else vertexNormals.set(v, [normals.get(f)!]);
      }
    }
    const moved = new Map<number, number>();
    for (const [v, list] of vertexNormals) {
      const id = addVertex(work, add3(work.vertices[v], shellOffset(list, distance)));
      moved.set(v, id);
      newVertices.push(id);
    }
    // Side walls only along the region boundary: edges with exactly one face in this region.
    for (const f of region) {
      const loop = work.faces[f];
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const inside = topo.edgeFaces[topo.faceEdges[f][i]].filter((g) => inRegion.has(g)).length;
        if (inside === 1) addFace(work, [a, b, moved.get(b)!, moved.get(a)!], work.slots[f]);
      });
    }
    for (const f of region) work.faces[f] = work.faces[f].map((v) => moved.get(v)!);
  }
  return complete(mesh, work, { faces: selected, vertices: newVertices });
}

/**
 * Region extrude (Blender E on faces). Connected selected faces move together as one shell; side
 * quads are built only along the region's boundary edges and the original faces become the caps.
 * Returns `faces` = the cap faces (same indices as the input selection), `vertices` = the moved copies.
 */
export function extrudeFaces(mesh: ModelPartMesh, faceIndices: readonly number[], distance: number): MeshOpResult {
  return extrudeRegions(mesh, faceIndices, distance, false);
}

/**
 * Extrude every selected face separately along its own normal (Blender "Extrude Individual Faces").
 * Returns `faces` = the caps, `vertices` = the new cap vertices.
 */
export function extrudeFacesIndividual(mesh: ModelPartMesh, faceIndices: readonly number[], distance: number): MeshOpResult {
  return extrudeRegions(mesh, faceIndices, distance, true);
}

// ------------------------------------------------------------------------------------------------
// Inset
// ------------------------------------------------------------------------------------------------

/**
 * Inset faces (Blender I). Region mode insets the boundary of each connected region as a whole —
 * interior shared vertices stay put — while `individual` insets every face on its own. Boundary
 * vertices move inward along the miter of their two boundary edges so the rim has constant
 * `thickness`; `depth` then pushes the inner faces along their normal.
 * Returns `faces` = the inner faces (same indices as the selection), `vertices` = inner vertices.
 */
export function insetFaces(
  mesh: ModelPartMesh,
  faceIndices: readonly number[],
  thickness: number,
  options: { individual?: boolean; depth?: number } = {},
): MeshOpResult {
  const work = begin(mesh);
  const selected = validFaces(work, faceIndices);
  const depth = Number.isFinite(options.depth) ? (options.depth as number) : 0;
  if (!selected.length || !Number.isFinite(thickness)) return { mesh, faces: [] };
  const topo = buildTopology(work);
  const normals = new Map<number, Vec3>();
  for (const f of selected) normals.set(f, polygonNormal(work.vertices, work.faces[f]));
  const regions = options.individual ? selected.map((f) => [f]) : faceRegions(topo, selected);
  const innerVertices: number[] = [];
  for (const region of regions) {
    const inRegion = new Set(region);
    const inward = new Map<number, Vec3[]>();
    const vertexNormals = new Map<number, Vec3[]>();
    const boundary: Array<{ f: number; a: number; b: number }> = [];
    for (const f of region) {
      const loop = work.faces[f];
      const n = normals.get(f)!;
      loop.forEach((a, i) => {
        const list = vertexNormals.get(a);
        if (list) list.push(n);
        else vertexNormals.set(a, [n]);
        const b = loop[(i + 1) % loop.length];
        const inside = topo.edgeFaces[topo.faceEdges[f][i]].filter((g) => inRegion.has(g)).length;
        if (inside !== 1) return;
        boundary.push({ f, a, b });
        // CCW face seen from its normal: the interior lies to the left of a → b, i.e. n × (b - a).
        const dir = normalize3(cross3(n, normalize3(sub3(work.vertices[b], work.vertices[a]))));
        for (const v of [a, b]) {
          const vectors = inward.get(v);
          if (vectors) vectors.push(dir);
          else inward.set(v, [dir]);
        }
      });
    }
    const vertexNormal = (v: number) => normalize3((vertexNormals.get(v) ?? []).reduce((s, n) => add3(s, n), [0, 0, 0] as Vec3));
    const moved = new Map<number, number>();
    for (const [v, vectors] of inward) {
      let dir = normalize3(vectors.reduce((s, d) => add3(s, d), [0, 0, 0] as Vec3));
      if (length3(dir) < 0.5) dir = vectors[0];
      const meanDot = vectors.reduce((s, d) => s + dot3(dir, d), 0) / vectors.length;
      const offset = add3(scale3(dir, thickness / Math.max(meanDot, 0.15)), scale3(vertexNormal(v), depth));
      const id = addVertex(work, add3(work.vertices[v], offset));
      moved.set(v, id);
      innerVertices.push(id);
    }
    if (depth !== 0) {
      // Interior vertices belong only to region faces, so they can move in place.
      for (const v of vertexNormals.keys()) {
        if (moved.has(v)) continue;
        work.vertices[v] = add3(work.vertices[v], scale3(vertexNormal(v), depth));
        innerVertices.push(v);
      }
    }
    for (const { f, a, b } of boundary) addFace(work, [a, b, moved.get(b)!, moved.get(a)!], work.slots[f]);
    for (const f of region) work.faces[f] = work.faces[f].map((v) => moved.get(v) ?? v);
  }
  return complete(mesh, work, { faces: selected, vertices: innerVertices });
}

// ------------------------------------------------------------------------------------------------
// Bevel
// ------------------------------------------------------------------------------------------------

/**
 * Bevel (chamfer) edges, Blender Ctrl+B. Works on manifold geometry: an edge is skipped unless it
 * has exactly two faces and both endpoints are closed, consistently wound vertex fans. Each beveled
 * vertex is replaced by one point per adjacent face corner:
 *  - corner between two beveled edges → miter point inside the face (`width` from both edges);
 *  - corner next to one beveled edge → a point slid along the other (unbeveled) edge;
 * and a corner patch closes the hole left at the vertex (the triangle at a cube corner where three
 * beveled edges meet). `segments > 1` replaces each chamfer with an elliptical arc that is tangent
 * to both side faces. Where every edge at a vertex is beveled (a cube corner) the corner becomes a
 * rounded quad grid (+ a central polygon for odd segment counts) sharing the arc vertices; other
 * corners keep a single n-gon over the arc points. Two beveled edges turning at a valence-3 vertex
 * share one mitred profile. Returns `faces` = chamfer strips + corner patches.
 */
export function bevelEdges(mesh: ModelPartMesh, edges: ReadonlyArray<readonly [number, number]>, width: number, segments = 1): MeshOpResult {
  const work = begin(mesh);
  const segs = clampInt(segments, 1, 16);
  if (!(width > 0) || !edges.length) return { mesh, faces: [] };
  const topo = buildTopology(work);
  const orig = work.faces.map((loop) => [...loop]);
  const P = work.vertices;
  const bev = new Set<number>();
  for (const [a, b] of edges) {
    const e = edgeId(topo, a, b);
    if (e !== undefined && topo.edgeFaces[e].length === 2 && topo.edgeFaces[e][0] !== topo.edgeFaces[e][1]) bev.add(e);
  }
  const fans = new Map<number, number[]>();
  const bad = new Set<number>();
  for (const e of bev) {
    for (const v of topo.edges[e]) {
      if (fans.has(v) || bad.has(v)) continue;
      const fan = orderedFan(orig, topo, v);
      if (fan) fans.set(v, fan);
      else bad.add(v);
    }
  }
  for (const e of [...bev]) if (bad.has(topo.edges[e][0]) || bad.has(topo.edges[e][1])) bev.delete(e);
  if (!bev.size) return { mesh, faces: [] };
  const bevVerts = new Set<number>();
  for (const e of bev) for (const v of topo.edges[e]) bevVerts.add(v);

  const corner = (f: number, v: number) => {
    const loop = orig[f];
    const i = loop.indexOf(v);
    const p = loop[(i + loop.length - 1) % loop.length];
    const n = loop[(i + 1) % loop.length];
    const uP = normalize3(sub3(P[p], P[v]));
    const uN = normalize3(sub3(P[n], P[v]));
    return {
      p,
      n,
      uP,
      uN,
      eP: edgeId(topo, p, v)!,
      eN: edgeId(topo, v, n)!,
      sin: Math.max(length3(cross3(uP, uN)), 0.2),
    };
  };

  // Slide points on unbeveled edges that border a beveled one (shared by both faces of that edge).
  const slideDistances = new Map<string, number[]>();
  const pushSlide = (v: number, e: number, d: number) => {
    const key = `${v}:${e}`;
    const list = slideDistances.get(key);
    if (list) list.push(d);
    else slideDistances.set(key, [d]);
  };
  for (const v of bevVerts) {
    for (const f of fans.get(v)!) {
      const c = corner(f, v);
      const bP = bev.has(c.eP);
      const bN = bev.has(c.eN);
      if (bP && !bN) pushSlide(v, c.eN, width / c.sin);
      if (!bP && bN) pushSlide(v, c.eP, width / c.sin);
    }
  }
  const slideIds = new Map<string, number>();
  for (const [key, distances] of slideDistances) {
    const [v, e] = key.split(':').map(Number);
    const [ea, eb] = topo.edges[e];
    const w = ea === v ? eb : ea;
    const span = sub3(P[w], P[v]);
    const d = Math.min(distances.reduce((s, x) => s + x, 0) / distances.length, 0.49 * length3(span));
    slideIds.set(key, addVertex(work, add3(P[v], scale3(normalize3(span), d))));
  }

  const replace = new Map<string, number[]>();
  for (const v of bevVerts) {
    for (const f of fans.get(v)!) {
      const c = corner(f, v);
      const bP = bev.has(c.eP);
      const bN = bev.has(c.eN);
      let points: number[];
      if (bP && bN) {
        const limit = 0.49 * Math.min(length3(sub3(P[c.p], P[v])), length3(sub3(P[c.n], P[v])));
        const t = Math.min(width / c.sin, limit);
        points = [addVertex(work, add3(P[v], scale3(add3(c.uP, c.uN), t)))];
      } else if (bP) {
        points = [slideIds.get(`${v}:${c.eN}`)!];
      } else if (bN) {
        points = [slideIds.get(`${v}:${c.eP}`)!];
      } else {
        const a = slideIds.get(`${v}:${c.eP}`) ?? v;
        const b = slideIds.get(`${v}:${c.eN}`) ?? v;
        points = a === b ? [a] : [a, b];
      }
      replace.set(`${f}:${v}`, points);
    }
  }
  const R = (f: number, v: number) => replace.get(`${f}:${v}`)!;

  // Strip ends (chords) per beveled edge, oriented so f1 runs a → b.
  const strips = [...bev].map((e) => {
    let [a, b] = topo.edges[e];
    let [f1, f2] = topo.edgeFaces[e];
    if (!hasDirected(orig[f1], a, b)) [f1, f2] = [f2, f1];
    if (!hasDirected(orig[f1], a, b)) [a, b] = [b, a];
    const rA1 = R(f1, a);
    const rA2 = R(f2, a);
    const rB1 = R(f1, b);
    const rB2 = R(f2, b);
    return { a, b, f1, A1: rA1[rA1.length - 1], A2: rA2[0], B1: rB1[0], B2: rB2[rB2.length - 1] };
  });
  // A chord used by two strips is a mitred turn (two beveled edges + one plain edge at a valence-3
  // vertex): both strips share one profile, which then lies on the miter between their cylinders.
  const chordUse = new Map<number, number>();
  for (const s of strips) {
    for (const key of [edgeKey(s.A1, s.A2), edgeKey(s.B1, s.B2)]) chordUse.set(key, (chordUse.get(key) ?? 0) + 1);
  }

  // Profile arcs, shared by every face that ends up holding the same chord.
  const arcs = new Map<number, number[]>();
  const arcCenters = new Map<number, Vec3>();
  const arc = (A: number, B: number, a: number, b: number): number[] => {
    if (segs === 1) return [A, B];
    const existing = arcs.get(edgeKey(A, B));
    if (existing) return existing[0] === A ? existing : [...existing].reverse();
    const pa = work.vertices[A];
    const pb = work.vertices[B];
    const origin = P[a];
    const dir = normalize3(sub3(P[b], P[a]));
    const project = (p: Vec3) => add3(origin, scale3(dir, dot3(sub3(p, origin), dir)));
    const mitred = (chordUse.get(edgeKey(A, B)) ?? 0) > 1 && topo.vertexEdges[a].length === 3;
    const corner3 = mitred ? P[a] : scale3(add3(project(pa), project(pb)), 0.5);
    const center = sub3(add3(pa, pb), corner3);
    arcCenters.set(edgeKey(A, B), center);
    const toA = sub3(pa, corner3);
    const toB = sub3(pb, corner3);
    const points = [A];
    for (let k = 1; k < segs; k += 1) {
      const phi = (k / segs) * (Math.PI / 2);
      points.push(addVertex(work, sub3(sub3(center, scale3(toA, Math.sin(phi))), scale3(toB, Math.cos(phi)))));
    }
    points.push(B);
    arcs.set(edgeKey(A, B), points);
    return points;
  };

  const created: number[] = [];
  const chamferFaces = new Set<number>();
  for (const { a, b, f1, A1, A2, B1, B2 } of strips) {
    const atA = arc(A1, A2, a, b);
    const atB = arc(B1, B2, b, a);
    for (let j = 0; j < segs; j += 1) {
      const id = addFace(work, [atB[j], atA[j], atA[j + 1], atB[j + 1]], work.slots[f1]);
      created.push(id);
      chamferFaces.add(id);
    }
  }
  orig.forEach((loop, f) => {
    if (!loop.some((v) => bevVerts.has(v))) return;
    work.faces[f] = loop.flatMap((v) => (bevVerts.has(v) ? R(f, v) : [v]));
    if (work.uvs) work.uvs = undefined;
  });
  // Rounded corner patches where every edge at the vertex is beveled (segments > 1).
  const rounded = new Set<number>();
  if (segs > 1) {
    for (const v of bevVerts) {
      const fan = fans.get(v)!;
      if (fan.length < 3 || !topo.vertexEdges[v].every((e) => bev.has(e))) continue;
      const patch = roundedCornerPatch(work, fan.map((f) => R(f, v)), arcs, arcCenters, segs);
      if (!patch) continue;
      rounded.add(v);
      for (const loop of patch) {
        const id = addFace(work, loop, work.slots[fan[0]]);
        created.push(id);
        chamferFaces.add(id);
      }
    }
  }
  for (const v of bevVerts) {
    if (rounded.has(v)) continue;
    const fan = fans.get(v)!;
    const sequence: number[] = [];
    for (const f of fan) for (const point of R(f, v)) if (sequence[sequence.length - 1] !== point) sequence.push(point);
    while (sequence.length > 1 && sequence[0] === sequence[sequence.length - 1]) sequence.pop();
    if (sequence.length < 3 || new Set(sequence).size !== sequence.length) continue;
    created.push(addFace(work, sequence.reverse(), work.slots[fan[0]]));
  }
  if (segs > 1) insertPolylines(work, arcs, chamferFaces);
  return complete(mesh, work, { faces: created });
}

/**
 * Rounded corner patch for a vertex where k ≥ 3 beveled edges meet (Blender's vertex mesh). The
 * hole is bounded by k profile arcs (`segs` segments each) between the k miter points. With
 * m = floor(segs / 2) it is filled by k m×m quad grids, one per miter corner; for even `segs` they
 * meet at one centre vertex, for odd `segs` they are separated by k quad strips around a central
 * k-gon (a triangle at a cube corner). Boundary vertices ARE the arc vertices the strips use, so the
 * mesh stays closed. Interior vertices are relaxed (Laplacian) onto the sphere-ish surface centred
 * on the arcs' ellipse centres, then nudged toward their quads' planes. Adds vertices to `work`,
 * returns the patch loops (wound like the old single-polygon patch), or null when the arcs are missing.
 */
function roundedCornerPatch(
  work: Work,
  replacements: number[][],
  arcs: Map<number, number[]>,
  arcCenters: Map<number, Vec3>,
  segs: number,
): number[][] | null {
  const k = replacements.length;
  if (replacements.some((r) => r.length !== 1)) return null;
  const corners = replacements.map((r) => r[0]);
  if (new Set(corners).size !== k) return null;
  const n = segs;
  const lines: number[][] = [];
  const centers: Vec3[] = [];
  for (let i = 0; i < k; i += 1) {
    const key = edgeKey(corners[i], corners[(i + 1) % k]);
    const line = arcs.get(key);
    const center = arcCenters.get(key);
    if (!line || line.length !== n + 1 || !center) return null;
    lines.push(line[0] === corners[i] ? line : [...line].reverse());
    centers.push(center);
  }
  const m = Math.floor(n / 2);
  const odd = n % 2 === 1;
  const P = work.vertices;
  const ids = new Map<string, number>();
  const interior: number[] = [];
  const guess = new Map<number, Vec3>();
  const wrap = (i: number) => ((i % k) + k) % k;
  // Grid vertex (a, b) of corner region i: a runs along arc i from its corner, b along arc i-1.
  const g = (i0: number, a: number, b: number): number => {
    const i = wrap(i0);
    if (b === 0) return lines[i][a];
    if (a === 0) return lines[wrap(i - 1)][n - b];
    if (!odd && b === m && a < m) return g(i - 1, m, a);
    const key = !odd && a === m && b === m ? 'c' : `${i},${a},${b}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = addVertex(work, [0, 0, 0]);
      ids.set(key, id);
      interior.push(id);
      // Initial guess: parallelogram completion from the region's two boundary arcs.
      guess.set(id, key === 'c' ? scale3(lines.reduce((s, l) => add3(s, P[l[m]]), [0, 0, 0] as Vec3), 1 / k) : sub3(add3(P[lines[i][a]], P[lines[wrap(i - 1)][n - b]]), P[lines[i][0]]));
    }
    return id;
  };
  const loops: number[][] = [];
  for (let i = 0; i < k; i += 1) {
    for (let a = 0; a < m; a += 1) for (let b = 0; b < m; b += 1) loops.push([g(i, a, b), g(i, a, b + 1), g(i, a + 1, b + 1), g(i, a + 1, b)]);
  }
  if (odd) {
    for (let i = 0; i < k; i += 1) for (let b = 0; b < m; b += 1) loops.push([g(i, m, b), g(i, m, b + 1), g(i + 1, b + 1, m), g(i + 1, b, m)]);
    const center: number[] = [];
    for (let i = k - 1; i >= 0; i -= 1) center.push(g(i, m, m));
    loops.push(center);
  }

  // Sphere-ish target surface: the profile arcs' ellipse centres agree (within reason) on a centre.
  const S = scale3(centers.reduce((s, c) => add3(s, c), [0, 0, 0] as Vec3), 1 / k);
  const boundary = lines.flat();
  const meanRadius = boundary.reduce((s, v) => s + length3(sub3(P[v], S)), 0) / boundary.length;
  const useSphere = meanRadius > 1e-9 && centers.every((c) => length3(sub3(c, S)) < 0.35 * meanRadius);
  const neighbours = new Map<number, Set<number>>();
  for (const id of interior) neighbours.set(id, new Set());
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      neighbours.get(a)?.add(b);
      neighbours.get(b)?.add(a);
    }
  }
  const toSurface = (p: Vec3, around: Iterable<number>): Vec3 => {
    if (!useSphere) return p;
    const d = sub3(p, S);
    const len = length3(d);
    if (len < 1e-9) return p;
    let r = 0;
    let count = 0;
    for (const q of around) {
      r += length3(sub3(P[q], S));
      count += 1;
    }
    return add3(S, scale3(d, (count ? r / count : meanRadius) / len));
  };
  for (const id of interior) P[id] = toSurface(guess.get(id)!, boundary);
  const iterations = 2 * n + 8;
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const id of interior) {
      const around = neighbours.get(id)!;
      let sum: Vec3 = [0, 0, 0];
      for (const q of around) sum = add3(sum, P[q]);
      P[id] = toSurface(scale3(sum, 1 / around.size), around);
    }
  }
  // Planarize: pull each interior vertex toward the plane of the other three corners of its quads.
  const quadsOf = new Map<number, number[][]>();
  for (const loop of loops) {
    if (loop.length !== 4) continue;
    for (const v of loop) {
      if (!neighbours.has(v)) continue;
      const list = quadsOf.get(v);
      if (list) list.push(loop);
      else quadsOf.set(v, [loop]);
    }
  }
  for (let iter = 0; iter < 4; iter += 1) {
    for (const id of interior) {
      const quads = quadsOf.get(id);
      if (!quads?.length) continue;
      let sum: Vec3 = [0, 0, 0];
      for (const loop of quads) {
        const i = loop.indexOf(id);
        const prev = P[loop[(i + 3) % 4]];
        const opp = P[loop[(i + 2) % 4]];
        const next = P[loop[(i + 1) % 4]];
        const normal = normalize3(cross3(sub3(next, opp), sub3(prev, opp)));
        const p = P[id];
        sum = add3(sum, sub3(p, scale3(normal, dot3(sub3(p, opp), normal))));
      }
      P[id] = scale3(sum, 1 / quads.length);
    }
  }
  return loops;
}

/**
 * Vertex bevel (Blender Ctrl+Shift+B): cut each selected corner off by sliding a point `width`
 * along every edge at the vertex and capping the hole with one polygon. Needs closed manifold fans.
 * Returns `faces` = the new corner caps, `vertices` = the slide points.
 */
export function bevelVertices(mesh: ModelPartMesh, verts: readonly number[], width: number): MeshOpResult {
  const work = begin(mesh);
  if (!(width > 0)) return { mesh, faces: [] };
  const topo = buildTopology(work);
  const orig = work.faces.map((loop) => [...loop]);
  const P = work.vertices;
  const fans = new Map<number, number[]>();
  for (const v of validVerts(mesh, verts)) {
    const fan = orderedFan(orig, topo, v);
    if (fan) fans.set(v, fan);
  }
  if (!fans.size) return { mesh, faces: [] };
  const slide = new Map<string, number>();
  const newVertices: number[] = [];
  for (const v of fans.keys()) {
    for (const e of topo.vertexEdges[v]) {
      const [a, b] = topo.edges[e];
      const w = a === v ? b : a;
      const span = sub3(P[w], P[v]);
      const id = addVertex(work, add3(P[v], scale3(normalize3(span), Math.min(width, 0.49 * length3(span)))));
      slide.set(`${v}:${e}`, id);
      newVertices.push(id);
    }
  }
  const R = (f: number, v: number): number[] => {
    const loop = orig[f];
    const i = loop.indexOf(v);
    const p = loop[(i + loop.length - 1) % loop.length];
    const n = loop[(i + 1) % loop.length];
    return [slide.get(`${v}:${edgeId(topo, p, v)}`)!, slide.get(`${v}:${edgeId(topo, v, n)}`)!];
  };
  orig.forEach((loop, f) => {
    if (!loop.some((v) => fans.has(v))) return;
    work.faces[f] = loop.flatMap((v) => (fans.has(v) ? R(f, v) : [v]));
    if (work.uvs) work.uvs = undefined;
  });
  const created: number[] = [];
  for (const [v, fan] of fans) {
    const sequence: number[] = [];
    for (const f of fan) for (const point of R(f, v)) if (sequence[sequence.length - 1] !== point) sequence.push(point);
    while (sequence.length > 1 && sequence[0] === sequence[sequence.length - 1]) sequence.pop();
    if (sequence.length >= 3) created.push(addFace(work, sequence.reverse(), work.slots[fan[0]]));
  }
  return complete(mesh, work, { faces: created, vertices: newVertices });
}

// ------------------------------------------------------------------------------------------------
// Edge rings, loop cut
// ------------------------------------------------------------------------------------------------

interface EdgeRing {
  /** Ring edges, oriented so edges[j][0] ↔ edges[j+1][0] are joined by a quad side. */
  edges: MeshEdge[];
  /** quads[j] lies between edges[j] and edges[(j + 1) % edges.length]. */
  quads: number[];
  closed: boolean;
}

function walkRing(
  faces: number[][],
  topo: MeshTopology,
  s0: number,
  t0: number,
  face: number | undefined,
): { edges: MeshEdge[]; quads: number[]; closed: boolean; invalid: boolean } {
  const edges: MeshEdge[] = [];
  const quads: number[] = [];
  const seen = new Set<number>();
  const startKey = edgeKey(s0, t0);
  let s = s0;
  let t = t0;
  let f = face;
  while (f !== undefined) {
    const loop = faces[f];
    if (loop.length !== 4) break;
    if (seen.has(f)) return { edges, quads, closed: false, invalid: true };
    let i = -1;
    for (let k = 0; k < 4; k += 1) {
      const a = loop[k];
      const b = loop[(k + 1) % 4];
      if ((a === s && b === t) || (a === t && b === s)) i = k;
    }
    if (i < 0) break;
    const next: MeshEdge = loop[i] === s ? [loop[(i + 3) % 4], loop[(i + 2) % 4]] : [loop[(i + 2) % 4], loop[(i + 3) % 4]];
    seen.add(f);
    quads.push(f);
    edges.push(next);
    if (edgeKey(next[0], next[1]) === startKey) {
      // Back at the start: a closed ring (a reversed arrival would be a Möbius strip — unsupported).
      return { edges, quads, closed: true, invalid: next[0] !== s0 };
    }
    const e = edgeId(topo, next[0], next[1]);
    const around = e === undefined ? [] : topo.edgeFaces[e];
    if (around.length !== 2) break;
    f = around[0] === f ? around[1] : around[0];
    [s, t] = next;
  }
  return { edges, quads, closed: false, invalid: false };
}

/** The edge ring through `a–b`: walk across quads in both directions, stop at non-quads/boundaries. */
function edgeRing(faces: number[][], topo: MeshTopology, a: number, b: number): EdgeRing | null {
  const e = edgeId(topo, a, b);
  if (e === undefined) return null;
  const around = topo.edgeFaces[e];
  const forward = walkRing(faces, topo, a, b, around[0]);
  if (forward.invalid) return null;
  if (forward.closed) return { edges: [[a, b], ...forward.edges.slice(0, -1)], quads: forward.quads, closed: true };
  const backward = around.length === 2 ? walkRing(faces, topo, a, b, around[1]) : { edges: [], quads: [], closed: false, invalid: false };
  if (backward.invalid) return null;
  const quads = [...[...backward.quads].reverse(), ...forward.quads];
  if (new Set(quads).size !== quads.length) return null;
  return { edges: [...[...backward.edges].reverse(), [a, b], ...forward.edges], quads, closed: false };
}

/**
 * Loop cut (Blender Ctrl+R): split every quad of the edge ring through `edge` with `cuts` evenly
 * spaced edges (`factor` slides a single cut along the ring, 0..1 from `edge[0]` towards `edge[1]`).
 * Faces at the open ends of the ring receive the new vertices in their loops so nothing cracks.
 * UVs are interpolated. Returns `edges` = the new loop edges, `vertices` = the new loop vertices.
 */
export function loopCut(mesh: ModelPartMesh, edge: readonly [number, number], cuts = 1, factor = 0.5): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const ring = edgeRing(work.faces, topo, edge[0], edge[1]);
  if (!ring || !ring.quads.length) return { mesh, edges: [] };
  const n = clampInt(cuts, 1, 64);
  const ts =
    n === 1
      ? [Math.min(1 - 1e-3, Math.max(1e-3, Number.isFinite(factor) ? factor : 0.5))]
      : Array.from({ length: n }, (_, k) => (k + 1) / (n + 1));
  if (work.vertices.length + ring.edges.length * n > MAX_MESH_VERTICES || work.faces.length + ring.quads.length * n > MAX_MESH_FACES) {
    return { mesh, edges: [] };
  }
  const P = work.vertices;
  const splits = new Map<number, EdgeSplit>();
  const points = ring.edges.map(([s, t]) => {
    const ids = ts.map((tt) => addVertex(work, lerp3(P[s], P[t], tt)));
    const forward = s < t;
    splits.set(edgeKey(s, t), {
      min: Math.min(s, t),
      ids: forward ? ids : [...ids].reverse(),
      ts: forward ? ts : ts.map((tt) => 1 - tt).reverse(),
    });
    return ids;
  });
  const ringQuads = new Set(ring.quads);
  const newEdges: MeshEdge[] = [];
  const params = [0, ...ts, 1];
  ring.quads.forEach((f, j) => {
    const next = (j + 1) % ring.edges.length;
    const [s, t] = ring.edges[j];
    const [s2, t2] = ring.edges[next];
    const loop = work.faces[f];
    const uv = work.uvs?.[f];
    const c = [s, ...points[j], t];
    const d = [s2, ...points[next], t2];
    const uvOf = (v: number) => uv![loop.indexOf(v)];
    const cUV = uv ? params.map((tt) => lerpUV(uvOf(s), uvOf(t), tt)) : [];
    const dUV = uv ? params.map((tt) => lerpUV(uvOf(s2), uvOf(t2), tt)) : [];
    const forward = hasDirected(loop, s, t);
    const slot = work.slots[f];
    for (let k = 0; k <= n; k += 1) {
      const order = forward ? [[0, k], [0, k + 1], [1, k + 1], [1, k]] : [[0, k + 1], [0, k], [1, k], [1, k + 1]];
      const piece = order.map(([rail, index]) => (rail === 0 ? c[index] : d[index]));
      const pieceUV = uv ? order.map(([rail, index]) => (rail === 0 ? cUV[index] : dUV[index])) : undefined;
      if (k === 0) {
        work.faces[f] = piece;
        if (work.uvs && pieceUV) work.uvs[f] = pieceUV;
      } else {
        addFace(work, piece, slot, pieceUV);
      }
    }
    for (let k = 1; k <= n; k += 1) newEdges.push([c[k], d[k]]);
  });
  insertSplits(work, splits, ringQuads);
  return complete(mesh, work, { edges: newEdges, vertices: points.flat() });
}

// ------------------------------------------------------------------------------------------------
// Selection helpers
// ------------------------------------------------------------------------------------------------

const normEdge = ([a, b]: readonly [number, number]): MeshEdge => (a < b ? [a, b] : [b, a]);

/** Next edge of an edge loop leaving vertex `v` via edge `e`, or -1 at poles and dead ends. */
function nextLoopEdge(topo: MeshTopology, e: number, v: number): number {
  const isBoundary = topo.edgeFaces[e].length === 1;
  if (isBoundary) {
    const others = topo.vertexEdges[v].filter((x) => x !== e && topo.edgeFaces[x].length === 1);
    return others.length === 1 ? others[0] : -1;
  }
  if (topo.vertexEdges[v].length !== 4 || topo.vertexFaces[v].length !== 4) return -1;
  const faces = new Set(topo.edgeFaces[e]);
  const opposite = topo.vertexEdges[v].filter((x) => x !== e && !topo.edgeFaces[x].some((f) => faces.has(f)));
  return opposite.length === 1 ? opposite[0] : -1;
}

/**
 * Edge loop through `edge` (Blender Alt+click): continue straight through valence-4 vertices,
 * stop at poles; boundary edges follow the boundary. Returns [min, max] vertex pairs.
 */
export function selectEdgeLoop(mesh: ModelPartMesh, edge: readonly [number, number]): MeshEdge[] {
  const poly = ensurePolyMesh(mesh);
  const topo = buildTopology(poly);
  const start = edgeId(topo, edge[0], edge[1]);
  if (start === undefined) return [];
  const picked = new Set<number>([start]);
  const [a, b] = topo.edges[start];
  for (const from of [b, a]) {
    let e = start;
    let v = from;
    for (let guard = 0; guard < topo.edges.length; guard += 1) {
      const next = nextLoopEdge(topo, e, v);
      if (next < 0 || picked.has(next)) break;
      picked.add(next);
      const [x, y] = topo.edges[next];
      v = x === v ? y : x;
      e = next;
    }
  }
  return [...picked].map((e) => normEdge(topo.edges[e]));
}

/** Edge ring through `edge` (Blender Ctrl+Alt+click): the opposite edges across consecutive quads. */
export function selectEdgeRing(mesh: ModelPartMesh, edge: readonly [number, number]): MeshEdge[] {
  const poly = ensurePolyMesh(mesh);
  const ring = edgeRing(poly.faces!, buildTopology(poly), edge[0], edge[1]);
  return ring ? ring.edges.map(normEdge) : [];
}

/** Face loop: the quads of the edge ring through `edge` (Alt+click in face mode). */
export function selectFaceLoop(mesh: ModelPartMesh, edge: readonly [number, number]): number[] {
  const poly = ensurePolyMesh(mesh);
  const ring = edgeRing(poly.faces!, buildTopology(poly), edge[0], edge[1]);
  return ring ? [...ring.quads] : [];
}

/** Every face of the islands (vertex-connected) touching the given faces — Blender Ctrl+L. */
export function selectLinked(mesh: ModelPartMesh, faces: readonly number[]): number[] {
  const poly = ensurePolyMesh(mesh);
  const topo = buildTopology(poly);
  const all = poly.faces!;
  const seen = new Set<number>();
  const queue = faces.filter((f) => f >= 0 && f < all.length);
  for (const f of queue) seen.add(f);
  while (queue.length) {
    const f = queue.pop()!;
    for (const v of all[f]) {
      for (const g of topo.vertexFaces[v]) {
        if (seen.has(g)) continue;
        seen.add(g);
        queue.push(g);
      }
    }
  }
  return uniqueSorted(seen);
}

/** Grow a vertex selection by one face step (Blender Ctrl+Numpad+ with "face step"). */
export function growSelection(mesh: ModelPartMesh, verts: readonly number[]): number[] {
  const poly = ensurePolyMesh(mesh);
  const topo = buildTopology(poly);
  const result = new Set(validVerts(poly, verts));
  for (const v of [...result]) for (const f of topo.vertexFaces[v]) for (const w of poly.faces![f]) result.add(w);
  return uniqueSorted(result);
}

/** Shrink: keep a selected vertex only if every face around it is fully selected. */
export function shrinkSelection(mesh: ModelPartMesh, verts: readonly number[]): number[] {
  const poly = ensurePolyMesh(mesh);
  const topo = buildTopology(poly);
  const selected = new Set(validVerts(poly, verts));
  return [...selected]
    .filter((v) => topo.vertexFaces[v].every((f) => poly.faces![f].every((w) => selected.has(w))))
    .sort((a, b) => a - b);
}

export function facesToVertices(mesh: ModelPartMesh, faces: readonly number[]): number[] {
  const all = ensurePolyMesh(mesh).faces!;
  return uniqueSorted(faces.filter((f) => f >= 0 && f < all.length).flatMap((f) => all[f]));
}

export function edgesToVertices(edges: ReadonlyArray<readonly [number, number]>): number[] {
  return uniqueSorted(edges.flatMap(([a, b]) => [a, b]));
}

/** Faces whose corners are all selected (`requireAll`) or that touch any selected vertex. */
export function verticesToFaces(mesh: ModelPartMesh, verts: readonly number[], requireAll = true): number[] {
  const selected = new Set(verts);
  const result: number[] = [];
  ensurePolyMesh(mesh).faces!.forEach((loop, f) => {
    if (requireAll ? loop.every((v) => selected.has(v)) : loop.some((v) => selected.has(v))) result.push(f);
  });
  return result;
}

/** Polygon edges with both endpoints selected. */
export function verticesToEdges(mesh: ModelPartMesh, verts: readonly number[]): MeshEdge[] {
  const selected = new Set(verts);
  return buildTopology(ensurePolyMesh(mesh)).edges.filter(([a, b]) => selected.has(a) && selected.has(b)).map(normEdge);
}

// ------------------------------------------------------------------------------------------------
// Merge, delete, dissolve
// ------------------------------------------------------------------------------------------------

/**
 * Rebuild faces through a vertex remap, collapsing repeated corners and dropping faces that fall
 * below three distinct corners (UV corners follow their vertex).
 */
function remapFaces(work: Work, target: (v: number) => number): void {
  const faces: number[][] = [];
  const slots: number[] = [];
  const uvs: UV[][] = [];
  work.faces.forEach((loop, f) => {
    const out: number[] = [];
    const corners: number[] = [];
    loop.forEach((v, i) => {
      const mapped = target(v);
      if (out.length && out[out.length - 1] === mapped) return;
      out.push(mapped);
      corners.push(i);
    });
    while (out.length > 1 && out[0] === out[out.length - 1]) {
      out.pop();
      corners.pop();
    }
    if (out.length < 3 || new Set(out).size !== out.length) return;
    faces.push(out);
    slots.push(work.slots[f]);
    const uv = work.uvs?.[f];
    if (uv) uvs.push(corners.map((i) => uv[i]));
  });
  work.faces = faces;
  work.slots = slots;
  work.uvs = work.uvs ? uvs : undefined;
  work.sharp = work.sharp?.map(([a, b]) => [target(a), target(b)] as MeshEdge).filter(([a, b]) => a !== b);
}

/**
 * Merge vertices into one (Blender M): at the center, the first/last selected vertex, or a cursor
 * position. Faces collapsing below three corners are removed. Returns `vertices` = [merged vertex].
 */
export function mergeVertices(
  mesh: ModelPartMesh,
  verts: readonly number[],
  mode: 'center' | 'first' | 'last' | 'cursor' = 'center',
  cursor?: readonly number[],
): MeshOpResult {
  const ordered = [...new Set(verts.filter((v) => Number.isInteger(v) && v >= 0 && v < mesh.vertices.length))];
  if (ordered.length < 2) return { mesh, vertices: ordered };
  const work = begin(mesh);
  const keep = ordered[0];
  const center = scale3(ordered.reduce((s, v) => add3(s, work.vertices[v]), [0, 0, 0] as Vec3), 1 / ordered.length);
  const position: Vec3 =
    mode === 'first'
      ? work.vertices[ordered[0]]
      : mode === 'last'
        ? work.vertices[ordered[ordered.length - 1]]
        : mode === 'cursor' && cursor && cursor.length === 3 && cursor.every(Number.isFinite)
          ? [cursor[0], cursor[1], cursor[2]]
          : center;
  work.vertices[keep] = [position[0], position[1], position[2]];
  const merged = new Set(ordered);
  remapFaces(work, (v) => (merged.has(v) ? keep : v));
  return complete(mesh, work, { vertices: [keep] });
}

/** Delete faces (vertices no longer used are removed). Returns `faces` = []. */
export function deleteFaces(mesh: ModelPartMesh, faces: readonly number[]): MeshOpResult {
  const work = begin(mesh);
  const doomed = new Set(validFaces(work, faces));
  if (!doomed.size) return { mesh, faces: [] };
  const keepIndex = work.faces.map((_, f) => !doomed.has(f));
  work.faces = work.faces.filter((_, f) => keepIndex[f]);
  work.slots = work.slots.filter((_, f) => keepIndex[f]);
  if (work.uvs) work.uvs = work.uvs.filter((_, f) => keepIndex[f]);
  return complete(mesh, work, { faces: [] });
}

/** Delete vertices and every face using them. */
export function deleteVertices(mesh: ModelPartMesh, verts: readonly number[]): MeshOpResult {
  const doomed = new Set(verts);
  const faces = ensurePolyMesh(mesh).faces!;
  return deleteFaces(
    mesh,
    faces.map((loop, f) => (loop.some((v) => doomed.has(v)) ? f : -1)).filter((f) => f >= 0),
  );
}

/**
 * Union the faces across each dissolvable edge and replace every group by its single boundary loop
 * (UV corners come along). Groups whose union is not a simple disc (holes, pinches) are left alone.
 * Afterwards vertices in `cleanup` that ended up with only two edges are removed from their loops,
 * as Blender's dissolve does. Returns the indices (post-op) of the merged faces.
 */
function dissolveCore(work: Work, edgeIds: Iterable<number>, cleanup: Set<number>): number[] {
  const topo = buildTopology(work);
  const parent = work.faces.map((_, f) => f);
  const find = (f: number): number => {
    while (parent[f] !== f) {
      parent[f] = parent[parent[f]];
      f = parent[f];
    }
    return f;
  };
  for (const e of edgeIds) {
    const pair = topo.edgeFaces[e];
    if (!pair || pair.length !== 2 || pair[0] === pair[1]) continue;
    const ra = find(pair[0]);
    const rb = find(pair[1]);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groups = new Map<number, number[]>();
  work.faces.forEach((_, f) => {
    const root = find(f);
    const list = groups.get(root);
    if (list) list.push(f);
    else groups.set(root, [f]);
  });
  const replaced = new Map<number, { loop: number[]; uv?: UV[] }>();
  const removed = new Set<number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const inGroup = new Set(group);
    const next = new Map<number, { b: number; uv?: UV }>();
    let ok = true;
    for (const f of group) {
      const loop = work.faces[f];
      loop.forEach((a, i) => {
        const around = topo.edgeFaces[topo.faceEdges[f][i]];
        if (around.length > 1 && around.every((g) => inGroup.has(g))) return;
        if (next.has(a)) ok = false;
        next.set(a, { b: loop[(i + 1) % loop.length], uv: work.uvs?.[f][i] });
      });
    }
    if (!ok || next.size < 3) continue;
    const start = next.keys().next().value as number;
    const loop: number[] = [];
    const uv: UV[] = [];
    let cur: number | undefined = start;
    do {
      const step: { b: number; uv?: UV } | undefined = next.get(cur);
      if (!step) break;
      loop.push(cur);
      if (step.uv) uv.push(step.uv);
      cur = step.b;
    } while (cur !== start && loop.length <= next.size);
    if (cur !== start || loop.length !== next.size) continue;
    replaced.set(group[0], { loop, uv: uv.length === loop.length ? uv : undefined });
    for (const f of group.slice(1)) removed.add(f);
  }
  const faces: number[][] = [];
  const slots: number[] = [];
  const uvs: UV[][] = [];
  const merged: number[] = [];
  let uvsOk = !!work.uvs;
  work.faces.forEach((loop, f) => {
    if (removed.has(f)) return;
    const swap = replaced.get(f);
    if (swap) merged.push(faces.length);
    faces.push(swap ? swap.loop : loop);
    slots.push(work.slots[f]);
    const uv = swap ? swap.uv : work.uvs?.[f];
    if (uv) uvs.push(uv);
    else uvsOk = false;
  });
  work.faces = faces;
  work.slots = slots;
  work.uvs = uvsOk ? uvs : undefined;
  if (cleanup.size) {
    const after = buildTopology(work);
    for (const v of cleanup) {
      if (after.vertexEdges[v]?.length !== 2) continue;
      if (after.vertexFaces[v].some((f) => work.faces[f].length <= 3)) continue;
      for (const f of after.vertexFaces[v]) {
        const i = work.faces[f].indexOf(v);
        work.faces[f] = work.faces[f].filter((_, k) => k !== i);
        if (work.uvs) work.uvs[f] = work.uvs[f].filter((_, k) => k !== i);
      }
    }
  }
  return merged;
}

/**
 * Dissolve edges (Blender X → Dissolve Edges): the two faces sharing each manifold edge merge into
 * one n-gon; endpoints left with only two edges are dissolved too. Returns `faces` = merged faces.
 */
export function dissolveEdges(mesh: ModelPartMesh, edges: ReadonlyArray<readonly [number, number]>): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const ids: number[] = [];
  const cleanup = new Set<number>();
  for (const [a, b] of edges) {
    const e = edgeId(topo, a, b);
    if (e === undefined || topo.edgeFaces[e].length !== 2) continue;
    ids.push(e);
    cleanup.add(a);
    cleanup.add(b);
  }
  if (!ids.length) return { mesh, faces: [] };
  const merged = dissolveCore(work, ids, cleanup);
  return complete(mesh, work, { faces: merged });
}

/**
 * Dissolve vertices: a two-edge vertex is simply removed from its faces; any other vertex merges
 * the faces around it into one n-gon without it. Returns `faces` = merged faces.
 */
export function dissolveVertices(mesh: ModelPartMesh, verts: readonly number[]): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const selected = new Set(validVerts(mesh, verts));
  const ids: number[] = [];
  for (const v of selected) {
    if (topo.vertexEdges[v].length === 2) continue;
    for (const e of topo.vertexEdges[v]) if (topo.edgeFaces[e].length === 2) ids.push(e);
  }
  const merged = dissolveCore(work, ids, selected);
  return complete(mesh, work, { faces: merged });
}

// ------------------------------------------------------------------------------------------------
// Normals
// ------------------------------------------------------------------------------------------------

function flipInPlace(work: Work, f: number): void {
  work.faces[f] = [...work.faces[f]].reverse();
  if (work.uvs) work.uvs[f] = [...work.uvs[f]].reverse();
}

/** Reverse the winding of faces (UV corners reversed with them). Returns `faces` = the selection. */
export function flipFaces(mesh: ModelPartMesh, faces: readonly number[]): MeshOpResult {
  const work = begin(mesh);
  const selected = validFaces(work, faces);
  for (const f of selected) flipInPlace(work, f);
  return complete(mesh, work, { faces: selected });
}

/**
 * Recalculate normals outside (Blender Shift+N): BFS each edge-connected island making neighbour
 * windings agree across manifold edges, then flip any island whose signed volume (about its own
 * centroid) is negative. Returns `faces` = the faces that were flipped.
 */
export function recalculateNormalsOutside(mesh: ModelPartMesh): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const flip = new Array<boolean>(work.faces.length).fill(false);
  const visited = new Array<boolean>(work.faces.length).fill(false);
  const flipped: number[] = [];
  for (let seed = 0; seed < work.faces.length; seed += 1) {
    if (visited[seed]) continue;
    const island: number[] = [];
    const queue = [seed];
    visited[seed] = true;
    while (queue.length) {
      const f = queue.shift()!;
      island.push(f);
      const loop = work.faces[f];
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const pair = topo.edgeFaces[topo.faceEdges[f][i]];
        if (pair.length !== 2) return;
        const g = pair[0] === f ? pair[1] : pair[0];
        if (g === f || visited[g]) return;
        // f (as oriented) runs a→b iff it is not flipped; g must then run b→a.
        const fHasAB = !flip[f];
        flip[g] = hasDirected(work.faces[g], a, b) === fHasAB;
        visited[g] = true;
        queue.push(g);
      });
    }
    const verts = new Set(island.flatMap((f) => work.faces[f]));
    const centroid = scale3([...verts].reduce((s, v) => add3(s, work.vertices[v]), [0, 0, 0] as Vec3), 1 / Math.max(1, verts.size));
    let volume = 0;
    for (const f of island) {
      const loop = flip[f] ? [...work.faces[f]].reverse() : work.faces[f];
      const p0 = sub3(work.vertices[loop[0]], centroid);
      for (let k = 1; k + 1 < loop.length; k += 1) {
        volume += dot3(p0, cross3(sub3(work.vertices[loop[k]], centroid), sub3(work.vertices[loop[k + 1]], centroid))) / 6;
      }
    }
    const invert = volume < -1e-12;
    for (const f of island) {
      if (flip[f] !== invert) {
        flipInPlace(work, f);
        flipped.push(f);
      }
    }
  }
  return complete(mesh, work, { faces: flipped.sort((a, b) => a - b) });
}

// ------------------------------------------------------------------------------------------------
// Subdivide
// ------------------------------------------------------------------------------------------------

/**
 * Flat subdivide (Blender W → Subdivide): quads become a (cuts+1)² grid, triangles a (cuts+1)²
 * triangle lattice, n-gons a fan of corner quads around a center (cuts = 1) or triangles (cuts > 1).
 * Edge points are shared, and unselected neighbours get them inserted into their loops (they turn
 * into n-gons), so the result stays watertight. UVs are interpolated.
 * Returns `faces` = every face produced from the selection.
 */
export function subdivideFaces(mesh: ModelPartMesh, faces: readonly number[], cuts = 1): MeshOpResult {
  const work = begin(mesh);
  const selected = validFaces(work, faces);
  const c = clampInt(cuts, 1, 32);
  const n = c + 1;
  if (!selected.length) return { mesh, faces: [] };
  let faceBudget = work.faces.length - selected.length;
  let vertexBudget = work.vertices.length;
  const selectedEdges = new Set<number>();
  for (const f of selected) {
    const loop = work.faces[f];
    const len = loop.length;
    faceBudget += len <= 4 ? n * n : c === 1 ? len : len * n;
    vertexBudget += len === 4 ? (n - 1) * (n - 1) : len === 3 ? ((n - 1) * (n - 2)) / 2 : 1;
    for (let i = 0; i < len; i += 1) selectedEdges.add(edgeKey(loop[i], loop[(i + 1) % len]));
  }
  vertexBudget += selectedEdges.size * c;
  if (faceBudget > MAX_MESH_FACES || vertexBudget > MAX_MESH_VERTICES) return { mesh, faces: [] };

  const P = work.vertices;
  const splits = new Map<number, EdgeSplit>();
  const ts = Array.from({ length: c }, (_, k) => (k + 1) / n);
  const pointAt = (a: number, b: number, k: number): number => {
    if (k === 0) return a;
    if (k === n) return b;
    const key = edgeKey(a, b);
    let split = splits.get(key);
    if (!split) {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      split = { min, ids: ts.map((t) => addVertex(work, lerp3(P[min], P[max], t))), ts };
      splits.set(key, split);
    }
    return a === split.min ? split.ids[k - 1] : split.ids[n - 1 - k];
  };
  const blend = (corners: number[], weights: number[]): Vec3 =>
    corners.reduce((s, v, i) => add3(s, scale3(P[v], weights[i])), [0, 0, 0] as Vec3);
  const blendUV = (uv: UV[], weights: number[]): UV =>
    uv.reduce((s, q, i) => [s[0] + q[0] * weights[i], s[1] + q[1] * weights[i]] as UV, [0, 0] as UV);

  const produced: number[] = [];
  const subdivided = new Set(selected);
  for (const f of selected) {
    const loop = work.faces[f];
    const uv = work.uvs?.[f];
    const slot = work.slots[f];
    const pieces: Array<{ loop: number[]; uv?: UV[] }> = [];
    if (loop.length === 4) {
      const [p0, p1, p2, p3] = loop;
      const grid: number[][] = [];
      const gridUV: UV[][] = [];
      for (let j = 0; j <= n; j += 1) {
        grid.push([]);
        gridUV.push([]);
        for (let i = 0; i <= n; i += 1) {
          const u = i / n;
          const v = j / n;
          const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
          let id: number;
          if (j === 0) id = pointAt(p0, p1, i);
          else if (j === n) id = pointAt(p3, p2, i);
          else if (i === 0) id = pointAt(p0, p3, j);
          else if (i === n) id = pointAt(p1, p2, j);
          else id = addVertex(work, blend(loop, weights));
          grid[j].push(id);
          if (uv) gridUV[j].push(blendUV(uv, weights));
        }
      }
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const cells: Array<[number, number]> = [[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]];
          pieces.push({ loop: cells.map(([y, x]) => grid[y][x]), uv: uv ? cells.map(([y, x]) => gridUV[y][x]) : undefined });
        }
      }
    } else if (loop.length === 3) {
      const [p0, p1, p2] = loop;
      const lattice = new Map<string, { id: number; uv?: UV }>();
      const at = (i: number, j: number) => {
        const key = `${i},${j}`;
        let entry = lattice.get(key);
        if (!entry) {
          const weights = [1 - (i + j) / n, i / n, j / n];
          let id: number;
          if (j === 0) id = pointAt(p0, p1, i);
          else if (i === 0) id = pointAt(p0, p2, j);
          else if (i + j === n) id = pointAt(p1, p2, j);
          else id = addVertex(work, blend(loop, weights));
          entry = { id, uv: uv ? blendUV(uv, weights) : undefined };
          lattice.set(key, entry);
        }
        return entry;
      };
      const tri = (cells: Array<[number, number]>) => {
        const entries = cells.map(([i, j]) => at(i, j));
        pieces.push({ loop: entries.map((e) => e.id), uv: uv ? entries.map((e) => e.uv!) : undefined });
      };
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i + j < n; i += 1) {
          tri([[i, j], [i + 1, j], [i, j + 1]]);
          if (i + j < n - 1) tri([[i + 1, j], [i + 1, j + 1], [i, j + 1]]);
        }
      }
    } else {
      const len = loop.length;
      const centerWeights = loop.map(() => 1 / len);
      const center = addVertex(work, blend(loop, centerWeights));
      const centerUV = uv ? blendUV(uv, centerWeights) : undefined;
      if (c === 1) {
        const mids = loop.map((a, i) => pointAt(a, loop[(i + 1) % len], 1));
        const midUV = uv ? loop.map((_, i) => lerpUV(uv[i], uv[(i + 1) % len], 0.5)) : [];
        for (let i = 0; i < len; i += 1) {
          const prev = (i + len - 1) % len;
          pieces.push({
            loop: [mids[prev], loop[i], mids[i], center],
            uv: uv ? [midUV[prev], uv[i], midUV[i], centerUV!] : undefined,
          });
        }
      } else {
        const ring: number[] = [];
        const ringUV: UV[] = [];
        loop.forEach((a, i) => {
          const b = loop[(i + 1) % len];
          for (let k = 0; k < n; k += 1) {
            ring.push(pointAt(a, b, k));
            if (uv) ringUV.push(lerpUV(uv[i], uv[(i + 1) % len], k / n));
          }
        });
        for (let k = 0; k < ring.length; k += 1) {
          const k2 = (k + 1) % ring.length;
          pieces.push({ loop: [ring[k], ring[k2], center], uv: uv ? [ringUV[k], ringUV[k2], centerUV!] : undefined });
        }
      }
    }
    pieces.forEach((piece, index) => {
      if (index === 0) {
        work.faces[f] = piece.loop;
        if (work.uvs && piece.uv) work.uvs[f] = piece.uv;
        produced.push(f);
      } else {
        produced.push(addFace(work, piece.loop, slot, piece.uv));
      }
    });
  }
  insertSplits(work, splits, subdivided);
  return complete(mesh, work, { faces: produced });
}

// ------------------------------------------------------------------------------------------------
// Fill / bridge
// ------------------------------------------------------------------------------------------------

/**
 * Boundary loops in "fill" direction: for each boundary half-edge a → b of an existing face, a new
 * face closing the hole must run b → a. `fillNext.get(b) === a`, `fillFace.get(b)` = that face.
 */
function boundaryFill(work: Work, topo: MeshTopology): { fillNext: Map<number, number>; fillFace: Map<number, number> } {
  const fillNext = new Map<number, number>();
  const fillFace = new Map<number, number>();
  topo.edgeFaces.forEach((around, e) => {
    if (around.length !== 1) return;
    const f = around[0];
    let [a, b] = topo.edges[e];
    if (!hasDirected(work.faces[f], a, b)) [a, b] = [b, a];
    if (fillNext.has(b)) return;
    fillNext.set(b, a);
    fillFace.set(b, f);
  });
  return { fillNext, fillFace };
}

function fillCycle(fillNext: Map<number, number>, start: number): number[] | null {
  const loop = [start];
  let cur = fillNext.get(start);
  while (cur !== undefined && cur !== start) {
    if (loop.includes(cur) || loop.length > fillNext.size) return null;
    loop.push(cur);
    cur = fillNext.get(cur);
  }
  return cur === start && loop.length >= 3 ? loop : null;
}

/**
 * Fill (Blender F): close every boundary loop that contains one of the given vertices with a single
 * n-gon, wound to agree with its neighbours. Returns `faces` = the new faces.
 */
export function fillHole(mesh: ModelPartMesh, verts: readonly number[]): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const { fillNext, fillFace } = boundaryFill(work, topo);
  const done = new Set<number>();
  const created: number[] = [];
  for (const v of verts) {
    if (done.has(v) || !fillNext.has(v)) continue;
    const loop = fillCycle(fillNext, v);
    if (!loop) continue;
    for (const w of loop) done.add(w);
    created.push(addFace(work, loop, work.slots[fillFace.get(v)!] ?? -1));
  }
  if (!created.length) return { mesh, faces: [] };
  return complete(mesh, work, { faces: created });
}

/**
 * Bridge edge loops: join the two boundary loops touched by `verts` with a band of quads. Both loops
 * must have the same vertex count; the pairing rotation with the shortest total span is used.
 * Returns `faces` = the bridge quads (unchanged mesh if the loops can't be bridged).
 */
export function bridgeEdgeLoops(mesh: ModelPartMesh, verts: readonly number[]): MeshOpResult {
  const work = begin(mesh);
  const topo = buildTopology(work);
  const { fillNext, fillFace } = boundaryFill(work, topo);
  const loops: number[][] = [];
  const claimed = new Set<number>();
  for (const v of verts) {
    if (claimed.has(v) || !fillNext.has(v)) continue;
    const loop = fillCycle(fillNext, v);
    if (!loop) continue;
    for (const w of loop) claimed.add(w);
    loops.push(loop);
  }
  if (loops.length !== 2 || loops[0].length !== loops[1].length) return { mesh, faces: [] };
  const [A, B] = loops;
  const n = A.length;
  const P = work.vertices;
  let best = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s += 1) {
    let cost = 0;
    for (let i = 0; i < n; i += 1) cost += length3(sub3(P[A[i]], P[B[(((s - i) % n) + n) % n]]));
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  const b = (k: number) => B[((k % n) + n) % n];
  const created: number[] = [];
  for (let i = 0; i < n; i += 1) {
    created.push(addFace(work, [A[i], A[(i + 1) % n], b(best - i - 1), b(best - i)], work.slots[fillFace.get(A[i])!] ?? -1));
  }
  return complete(mesh, work, { faces: created });
}

// ------------------------------------------------------------------------------------------------
// Symmetry, soft selection, transforms
// ------------------------------------------------------------------------------------------------

/**
 * Mirror counterpart of every vertex across the `axis` = 0 plane: the vertex itself when it lies on
 * the plane, -1 when no vertex sits at the mirrored position (within `tolerance`).
 */
export function symmetryMap(mesh: ModelPartMesh, axis: MeshAxis, tolerance = 1e-4): Int32Array {
  const ai = AXIS_INDEX[axis];
  const tol = Math.max(tolerance, 1e-9);
  const cell = (x: number) => Math.floor(x / tol);
  const grid = new Map<string, number[]>();
  mesh.vertices.forEach((p, index) => {
    const key = `${cell(p[0])},${cell(p[1])},${cell(p[2])}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });
  const result = new Int32Array(mesh.vertices.length).fill(-1);
  mesh.vertices.forEach((p, index) => {
    if (Math.abs(p[ai]) <= tol) {
      result[index] = index;
      return;
    }
    const target: Vec3 = [p[0], p[1], p[2]];
    target[ai] = -target[ai];
    const cx = cell(target[0]);
    const cy = cell(target[1]);
    const cz = cell(target[2]);
    let best = -1;
    let bestDistance = tol;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const candidate of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = length3(sub3(mesh.vertices[candidate], target));
            if (d <= bestDistance) {
              bestDistance = d;
              best = candidate;
            }
          }
        }
      }
    }
    result[index] = best;
  });
  return result;
}

/** Blender's proportional-editing falloff curves; `t` = 1 at the selection, 0 at the radius. */
function falloffCurve(t: number, falloff: ProportionalFalloff): number {
  switch (falloff) {
    case 'constant':
      return 1;
    case 'linear':
      return t;
    case 'sharp':
      return t * t;
    case 'root':
      return Math.sqrt(t);
    case 'sphere':
      return Math.sqrt(Math.max(0, 2 * t - t * t));
    case 'smooth':
    default:
      return 3 * t * t - 2 * t * t * t;
  }
}

/**
 * Proportional-editing weights (Blender O): 1 for selected vertices, falloff by distance to the
 * nearest selected vertex for the rest within `radius` — straight-line distance, or the shortest
 * path along edges when `connectedOnly` (Blender "Connected Only"), computed with Dijkstra.
 * Vertices outside the radius are absent from the map.
 */
export function proportionalWeights(
  mesh: ModelPartMesh,
  selected: readonly number[],
  radius: number,
  falloff: ProportionalFalloff = 'smooth',
  connectedOnly = false,
): Map<number, number> {
  const weights = new Map<number, number>();
  const seeds = validVerts(mesh, selected);
  for (const v of seeds) weights.set(v, 1);
  if (!(radius > 0) || !seeds.length) return weights;
  const P = mesh.vertices;
  const distance = new Map<number, number>();
  if (connectedOnly) {
    const topo = buildTopology(ensurePolyMesh(mesh));
    const heap = new MinHeap();
    for (const v of seeds) {
      distance.set(v, 0);
      heap.push(0, v);
    }
    while (heap.size) {
      const [d, v] = heap.pop()!;
      if (d > (distance.get(v) ?? Infinity)) continue;
      for (const e of topo.vertexEdges[v]) {
        const [a, b] = topo.edges[e];
        const w = a === v ? b : a;
        const nd = d + length3(sub3(P[w], P[v]));
        if (nd >= radius || nd >= (distance.get(w) ?? Infinity)) continue;
        distance.set(w, nd);
        heap.push(nd, w);
      }
    }
  } else {
    const cell = (x: number) => Math.floor(x / radius);
    const grid = new Map<string, number[]>();
    P.forEach((p, index) => {
      const key = `${cell(p[0])},${cell(p[1])},${cell(p[2])}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    });
    for (const s of seeds) {
      const p = P[s];
      const cx = cell(p[0]);
      const cy = cell(p[1]);
      const cz = cell(p[2]);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const d = length3(sub3(P[w], p));
              if (d < radius && d < (distance.get(w) ?? Infinity)) distance.set(w, d);
            }
          }
        }
      }
    }
  }
  for (const [v, d] of distance) {
    if (weights.has(v)) continue;
    const weight = falloffCurve(1 - d / radius, falloff);
    if (weight > 0) weights.set(v, weight);
  }
  return weights;
}

class MinHeap {
  private items: Array<[number, number]> = [];
  get size(): number {
    return this.items.length;
  }
  push(priority: number, value: number): void {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): [number, number] | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Apply per-vertex deltas (the G/R/S tools resolve to this). With `symmetryAxes`, every delta is
 * mirrored onto the vertex's counterpart(s) across those planes — combinations included, so X+Y
 * symmetry also moves the diagonal copy — and vertices on a mirror plane keep that axis fixed so
 * the seam never opens. Explicit deltas win over mirrored ones. Topology is untouched.
 * Returns `vertices` = every vertex that moved.
 */
export function moveVertices(
  mesh: ModelPartMesh,
  deltas: Map<number, readonly number[]> | ReadonlyArray<readonly [number, readonly number[]]>,
  options: { symmetryAxes?: MeshAxis[] } = {},
): MeshOpResult {
  const poly = ensurePolyMesh(mesh);
  const entries = deltas instanceof Map ? [...deltas.entries()] : [...deltas];
  const axes = [...new Set(options.symmetryAxes ?? [])];
  const maps = axes.map((axis) => ({ ai: AXIS_INDEX[axis], map: symmetryMap(poly, axis) }));
  const explicit = new Map<number, Vec3>();
  const mirrored = new Map<number, Vec3>();
  for (const [v, d] of entries) {
    if (!Number.isInteger(v) || v < 0 || v >= poly.vertices.length || !d || d.length < 3 || !d.slice(0, 3).every(Number.isFinite)) continue;
    let copies: Array<{ v: number; d: Vec3; original: boolean }> = [{ v, d: [d[0], d[1], d[2]], original: true }];
    for (const { ai, map } of maps) {
      const expanded: typeof copies = [];
      for (const copy of copies) {
        const twin = map[copy.v];
        if (twin === copy.v) {
          const pinned: Vec3 = [...copy.d];
          pinned[ai] = 0;
          expanded.push({ ...copy, d: pinned });
        } else {
          expanded.push(copy);
          if (twin >= 0) {
            const flipped: Vec3 = [...copy.d];
            flipped[ai] = -flipped[ai];
            expanded.push({ v: twin, d: flipped, original: false });
          }
        }
      }
      copies = expanded;
    }
    for (const copy of copies) {
      if (copy.original) explicit.set(copy.v, copy.d);
      else if (!mirrored.has(copy.v)) mirrored.set(copy.v, copy.d);
    }
  }
  for (const [v, d] of mirrored) if (!explicit.has(v)) explicit.set(v, d);
  if (!explicit.size) return { mesh, vertices: [] };
  const vertices = poly.vertices.map((p, index) => {
    const d = explicit.get(index);
    return d ? add3(p, d) : p;
  });
  return {
    mesh: makePolyMesh(vertices, poly.faces!, { faceSlots: poly.faceSlots, faceUVs: poly.faceUVs, sharpEdges: poly.sharpEdges }),
    vertices: uniqueSorted(explicit.keys()),
  };
}

/**
 * Apply a mirror destructively: append a copy mirrored across the `axis` = 0 plane with reversed
 * winding (so it still faces outward), weld copy vertices lying on the plane back onto their
 * originals (snapping them exactly onto it) and drop faces lying in the plane, which would become
 * internal walls. UVs are mirrored per corner. Returns `faces` = the mirrored copies.
 */
export function mirrorMeshDestructive(mesh: ModelPartMesh, axis: MeshAxis, mergeDistance = 1e-4): MeshOpResult {
  const work = begin(mesh);
  const ai = AXIS_INDEX[axis];
  const count = work.vertices.length;
  const twin = new Array<number>(count);
  const onPlane = new Array<boolean>(count);
  for (let v = 0; v < count; v += 1) {
    const p = work.vertices[v];
    if (Math.abs(p[ai]) <= mergeDistance) {
      const snapped: Vec3 = [p[0], p[1], p[2]];
      snapped[ai] = 0;
      work.vertices[v] = snapped;
      twin[v] = v;
      onPlane[v] = true;
    } else {
      const mirrored: Vec3 = [p[0], p[1], p[2]];
      mirrored[ai] = -mirrored[ai];
      twin[v] = addVertex(work, mirrored);
      onPlane[v] = false;
    }
  }
  const originalCount = work.faces.length;
  const keep = work.faces.map((loop) => !loop.every((v) => onPlane[v]));
  const created: number[] = [];
  for (let f = 0; f < originalCount; f += 1) {
    if (!keep[f]) continue;
    const loop = work.faces[f];
    const uv = work.uvs?.[f];
    created.push(addFace(work, [...loop].reverse().map((v) => twin[v]), work.slots[f], uv ? [...uv].reverse() : undefined));
  }
  if (work.sharp) work.sharp = [...work.sharp, ...work.sharp.map(([a, b]) => [twin[a], twin[b]] as MeshEdge)];
  // Drop in-plane originals (their mirrored copies were never created).
  const dropped = keep.reduce((n, k) => n + (k ? 0 : 1), 0);
  if (dropped) {
    const mask = [...keep, ...created.map(() => true)];
    work.faces = work.faces.filter((_, f) => mask[f]);
    work.slots = work.slots.filter((_, f) => mask[f]);
    if (work.uvs) work.uvs = work.uvs.filter((_, f) => mask[f]);
  }
  const kept = keep.filter(Boolean).length;
  return complete(mesh, work, { faces: created.map((_, i) => kept + i) });
}

// ------------------------------------------------------------------------------------------------
// Bisect + knife
// ------------------------------------------------------------------------------------------------

/** A cutting plane: any point on it plus its normal (need not be unit length). */
export interface MeshPlane {
  point: readonly number[];
  normal: readonly number[];
}

export interface BisectOptions {
  /** Restrict the cut to these faces (default: every face). Neighbours stay watertight. */
  faces?: readonly number[];
  /** Delete the cut faces on the side opposite the normal ('inner') or along it ('outer'). */
  clear?: 'none' | 'inner' | 'outer';
  /** After clearing, close every cut boundary loop with an n-gon. */
  fill?: boolean;
}

/** Vertices closer to the plane than this count as lying on it (no sliver faces). */
const PLANE_EPSILON = 1e-6;

/** Even-odd point-in-polygon on 2D points, casting along +y (perpendicular to the cut line). */
function pointInPolygon2(x: number, y: number, points: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (xi > x !== xj > x) {
      const yAt = yi + ((x - xi) * (yj - yi)) / (xj - xi);
      if (yAt > y) inside = !inside;
    }
  }
  return inside;
}

/**
 * Split one polygon loop whose crossing edges already carry their on-plane vertices (signed distance
 * exactly 0). On-plane corners are sorted along the cut line; each gap between consecutive ones that
 * is not a polygon edge and lies inside the polygon becomes a chord. Splitting the loop at every
 * chord handles concave n-gons crossed several times (an L cap cut twice → three pieces).
 */
function splitLoopByPlane(
  vertices: readonly Vec3[],
  loop: readonly number[],
  dist: readonly number[],
  planeNormal: Vec3,
): { pieces: number[][]; chords: MeshEdge[] } {
  const none = { pieces: [[...loop]], chords: [] };
  const faceNormal = polygonNormal(vertices, loop);
  const line = cross3(planeNormal, faceNormal);
  if (length3(line) < 1e-9) return none;
  const along = normalize3(line);
  const across = normalize3(cross3(faceNormal, along));
  const origin = vertices[loop[0]];
  const points = loop.map((v) => {
    const r = sub3(vertices[v], origin);
    return [dot3(r, along), dot3(r, across)] as [number, number];
  });
  const count = loop.length;
  const onPlane = loop.map((_, i) => i).filter((i) => dist[loop[i]] === 0);
  onPlane.sort((i, j) => points[i][0] - points[j][0]);
  const chords: MeshEdge[] = [];
  for (let k = 0; k + 1 < onPlane.length; k += 1) {
    const i = onPlane[k];
    const j = onPlane[k + 1];
    const gap = Math.abs(i - j);
    if (gap === 1 || gap === count - 1) continue; // an existing edge lying in the plane
    if (points[j][0] - points[i][0] < 1e-12) continue;
    const mx = (points[i][0] + points[j][0]) / 2;
    const my = (points[i][1] + points[j][1]) / 2;
    if (pointInPolygon2(mx, my, points)) chords.push([loop[i], loop[j]]);
  }
  if (!chords.length) return none;
  let pieces: number[][] = [[...loop]];
  const used: MeshEdge[] = [];
  for (const [u, w] of chords) {
    const index = pieces.findIndex((piece) => {
      const i = piece.indexOf(u);
      const j = piece.indexOf(w);
      if (i < 0 || j < 0) return false;
      const gap = Math.abs(i - j);
      return gap !== 1 && gap !== piece.length - 1;
    });
    if (index < 0) continue;
    const piece = pieces[index];
    const i = piece.indexOf(u);
    const j = piece.indexOf(w);
    const span = (from: number, to: number) => {
      const out: number[] = [];
      for (let c = from; ; c = (c + 1) % piece.length) {
        out.push(piece[c]);
        if (c === to) break;
      }
      return out;
    };
    pieces = [...pieces.slice(0, index), span(i, j), span(j, i), ...pieces.slice(index + 1)];
    used.push([u, w]);
  }
  return { pieces, chords: used };
}

function planeCut(mesh: ModelPartMesh, plane: MeshPlane, options: BisectOptions): MeshOpResult {
  const unchanged: MeshOpResult = { mesh, edges: [] };
  const work = begin(mesh);
  if (!plane?.point || !plane?.normal || plane.point.length < 3 || plane.normal.length < 3) return unchanged;
  if (![...plane.point.slice(0, 3), ...plane.normal.slice(0, 3)].every(Number.isFinite)) return unchanged;
  const normal = normalize3(plane.normal);
  if (length3(normal) < 0.5) return unchanged;
  const origin: Vec3 = [plane.point[0], plane.point[1], plane.point[2]];
  const P = work.vertices;
  const dist = P.map((p) => {
    const d = dot3(sub3(p, origin), normal);
    return Math.abs(d) <= PLANE_EPSILON ? 0 : d;
  });
  const targets = options.faces ? validFaces(work, options.faces) : work.faces.map((_, f) => f);
  if (!targets.length) return unchanged;
  const clear = options.clear ?? 'none';

  // 1. One shared vertex per crossed edge of a target face, inserted into EVERY face using that edge.
  const splits = new Map<number, EdgeSplit>();
  const crossed: number[] = [];
  for (const f of targets) {
    const loop = work.faces[f];
    if (!loop.some((v) => dist[v] > 0) || !loop.some((v) => dist[v] < 0)) continue;
    crossed.push(f);
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = edgeKey(a, b);
      if (dist[a] * dist[b] >= 0 || splits.has(key)) continue;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const t = dist[min] / (dist[min] - dist[max]);
      const id = addVertex(work, lerp3(P[min], P[max], t));
      dist[id] = 0;
      splits.set(key, { min, ids: [id], ts: [t] });
    }
  }
  if (work.vertices.length > MAX_MESH_VERTICES) return unchanged;
  insertSplits(work, splits, new Set());

  // 2. Split the crossed faces into pieces along the plane.
  const region = new Set(targets);
  const chords: MeshEdge[] = [];
  for (const f of crossed) {
    const loop = work.faces[f];
    const { pieces, chords: cut } = splitLoopByPlane(work.vertices, loop, dist, normal);
    if (pieces.length < 2) continue;
    chords.push(...cut);
    const uv = work.uvs?.[f];
    const uvOf = uv ? new Map(loop.map((v, i) => [v, uv[i]] as [number, UV])) : undefined;
    pieces.forEach((piece, index) => {
      const pieceUV = uvOf ? piece.map((v) => uvOf.get(v)!) : undefined;
      if (index === 0) {
        work.faces[f] = piece;
        if (work.uvs && pieceUV) work.uvs[f] = pieceUV;
      } else {
        region.add(addFace(work, piece, work.slots[f], pieceUV));
      }
    });
  }

  // 3. Clear one side (only faces from the cut region).
  let cleared = 0;
  if (clear !== 'none') {
    const doomed = new Set<number>();
    for (const f of region) {
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      for (const v of work.faces[f]) {
        lo = Math.min(lo, dist[v]);
        hi = Math.max(hi, dist[v]);
        sum += dist[v];
      }
      const side = hi > 0 && lo >= 0 ? 1 : lo < 0 && hi <= 0 ? -1 : Math.sign(sum);
      if ((clear === 'inner' && side < 0) || (clear === 'outer' && side > 0)) doomed.add(f);
    }
    if (doomed.size >= work.faces.length) return unchanged; // would delete the whole mesh
    if (doomed.size) {
      const keep = work.faces.map((_, f) => !doomed.has(f));
      work.faces = work.faces.filter((_, f) => keep[f]);
      work.slots = work.slots.filter((_, f) => keep[f]);
      if (work.uvs) work.uvs = work.uvs.filter((_, f) => keep[f]);
      cleared = doomed.size;
    }
  }
  if (!chords.length && !cleared && !splits.size) return unchanged;

  // 4. Fill the open cut loops (every vertex on the plane) — wound to agree with their neighbours.
  if (options.fill && cleared) {
    const topo = buildTopology(work);
    const { fillNext, fillFace } = boundaryFill(work, topo);
    const done = new Set<number>();
    for (const start of [...fillNext.keys()]) {
      if (done.has(start) || dist[start] !== 0) continue;
      const loop = fillCycle(fillNext, start);
      if (!loop) continue;
      for (const v of loop) done.add(v);
      if (!loop.every((v) => dist[v] === 0)) continue;
      addFace(work, loop, work.slots[fillFace.get(start)!] ?? -1);
    }
  }
  return complete(mesh, work, { edges: chords });
}

/**
 * Bisect (Blender Bisect): cut every face — or only `options.faces` — crossed by `plane`. Each
 * crossed edge gets ONE new vertex, inserted into every face using that edge (unselected neighbours
 * become n-gons, never cracks). Convex and concave polygons split into as many pieces as the plane
 * produces. Vertices within 1e-6 of the plane count as on it. `clear` deletes the cut faces behind
 * ('inner') or in front of ('outer') the plane; `fill` then caps the open cut loops with n-gons, so
 * bisect + clear + fill is a clean planar cut of a closed solid. UVs are interpolated at cut points
 * (fill faces have none, so filling drops `faceUVs`); pieces keep their face's slot, fill faces take
 * the slot of an adjacent face. Returns `edges` = the new cut edges; the input unchanged when the
 * plane misses (or a clear would delete everything).
 */
export function bisectMesh(mesh: ModelPartMesh, plane: MeshPlane, options: BisectOptions = {}): MeshOpResult {
  return planeCut(mesh, plane, options);
}

/**
 * Knife core: split `cut.faces` along `cut.plane` (the plane through the drawn screen line and the
 * view direction), keeping neighbouring faces watertight. No clearing or filling.
 * Returns `edges` = the new cut edges.
 */
export function knifeCut(mesh: ModelPartMesh, cut: { plane: MeshPlane; faces: readonly number[] }): MeshOpResult {
  return planeCut(mesh, cut.plane, { faces: cut.faces ?? [], clear: 'none', fill: false });
}
