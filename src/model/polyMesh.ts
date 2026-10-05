import type { ModelPartMesh, Vector3Tuple } from '../types';

/**
 * Polygon-mesh core for Model Forge mesh parts. Pure data, no three.js.
 *
 * A mesh part's source of truth is `faces` — CCW polygon loops (quads, triangles, n-gons) over a
 * shared vertex list — exactly like Blender's edit mesh. Everything topological (loop cuts, insets,
 * bevels, Catmull-Clark) needs real quads and shared edges, which the old triangle list could not
 * express. `indices` is always re-derived from `faces` so physics, CSG and older readers keep working.
 *
 * Parallel per-face arrays (`faceSlots`, `faceUVs`) travel with their face through every op in this
 * module; ops that create faces copy the attributes of the face they grew from.
 */

export const MAX_MESH_VERTICES = 16384;
export const MAX_MESH_FACES = 16384;

export type Vec3 = Vector3Tuple;

// ------------------------------------------------------------------------------------------------
// Vector helpers
// ------------------------------------------------------------------------------------------------

export const sub3 = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: readonly number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length3 = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
export const normalize3 = (a: readonly number[]): Vec3 => {
  const length = length3(a);
  return length < 1e-12 ? [0, 0, 0] : [a[0] / length, a[1] / length, a[2] / length];
};
export const lerp3 = (a: readonly number[], b: readonly number[], t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ------------------------------------------------------------------------------------------------
// Face geometry
// ------------------------------------------------------------------------------------------------

/** Newell's method: robust unit normal for any (even slightly non-planar) polygon. */
export function polygonNormal(vertices: readonly Vec3[], loop: readonly number[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = vertices[loop[i]];
    const b = vertices[loop[(i + 1) % loop.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize3([nx, ny, nz]);
}

export function polygonCenter(vertices: readonly Vec3[], loop: readonly number[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const index of loop) {
    const vertex = vertices[index];
    sum[0] += vertex[0];
    sum[1] += vertex[1];
    sum[2] += vertex[2];
  }
  return scale3(sum, 1 / Math.max(1, loop.length));
}

export function polygonArea(vertices: readonly Vec3[], loop: readonly number[]): number {
  const total: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i += 1) {
    const c = cross3(vertices[loop[i]], vertices[loop[(i + 1) % loop.length]]);
    total[0] += c[0];
    total[1] += c[1];
    total[2] += c[2];
  }
  return length3(total) / 2;
}

/**
 * Triangulate one polygon loop into local corner indices (0..n-1), CCW preserved. Quads split along
 * their shorter diagonal; larger polygons use ear clipping on the best-fit plane, which handles the
 * concave n-gons insets and booleans produce. Falls back to a fan if clipping stalls.
 */
export function triangulateLoop(vertices: readonly Vec3[], loop: readonly number[]): number[] {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];
  if (n === 4) {
    const d02 = length3(sub3(vertices[loop[0]], vertices[loop[2]]));
    const d13 = length3(sub3(vertices[loop[1]], vertices[loop[3]]));
    return d02 <= d13 ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
  }
  const normal = polygonNormal(vertices, loop);
  // Project onto the plane with the dominant normal axis dropped.
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  const [u, v] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [2, 0] : [0, 1];
  const flip = (ax >= ay && ax >= az ? normal[0] : ay >= az ? normal[1] : normal[2]) < 0;
  const points = loop.map((index) => {
    const p = vertices[index];
    return flip ? [p[v], p[u]] : [p[u], p[v]];
  });
  const remaining = Array.from({ length: n }, (_, i) => i);
  const result: number[] = [];
  const area2 = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: number[], a: number[], b: number[], c: number[]) =>
    area2(a, b, p) >= -1e-12 && area2(b, c, p) >= -1e-12 && area2(c, a, p) >= -1e-12;
  let guard = n * n;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const ia = remaining[(i + remaining.length - 1) % remaining.length];
      const ib = remaining[i];
      const ic = remaining[(i + 1) % remaining.length];
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      if (area2(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let blocked = false;
      for (const other of remaining) {
        if (other === ia || other === ib || other === ic) continue;
        if (inside(points[other], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      result.push(ia, ib, ic);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    result.push(remaining[0], remaining[1], remaining[2]);
  } else {
    // Degenerate/self-intersecting loop: fan whatever is left so the face still renders.
    for (let i = 1; i + 1 < remaining.length; i += 1) result.push(remaining[0], remaining[i], remaining[i + 1]);
  }
  return result;
}

/** Triangle index list for a whole face set, plus which face each triangle came from. */
export function triangulateFaces(vertices: readonly Vec3[], faces: readonly number[][]): { indices: number[]; triangleFaces: number[] } {
  const indices: number[] = [];
  const triangleFaces: number[] = [];
  faces.forEach((loop, faceIndex) => {
    const local = triangulateLoop(vertices, loop);
    for (let i = 0; i < local.length; i += 3) {
      indices.push(loop[local[i]], loop[local[i + 1]], loop[local[i + 2]]);
      triangleFaces.push(faceIndex);
    }
  });
  return { indices, triangleFaces };
}

// ------------------------------------------------------------------------------------------------
// Edges + topology
// ------------------------------------------------------------------------------------------------

/** Order-independent edge key. Safe for vertex counts up to 2^26. */
export const edgeKey = (a: number, b: number): number => (a < b ? a * 67108864 + b : b * 67108864 + a);
export const edgeKeyVertices = (key: number): [number, number] => [Math.floor(key / 67108864), key % 67108864];

export interface MeshTopology {
  /** Unique edges [a, b] with a < b, in first-seen order. */
  edges: Array<[number, number]>;
  /** edgeKey → index into `edges`. */
  edgeIndex: Map<number, number>;
  /** Faces using each edge (1 = boundary, 2 = manifold interior, 3+ = non-manifold). */
  edgeFaces: number[][];
  /** Edge indices around each face, aligned so faceEdges[f][i] joins loop[i] → loop[i+1]. */
  faceEdges: number[][];
  /** Faces touching each vertex. */
  vertexFaces: number[][];
  /** Edges touching each vertex. */
  vertexEdges: number[][];
}

export function buildTopology(mesh: Pick<ModelPartMesh, 'vertices' | 'faces'>): MeshTopology {
  const faces = mesh.faces ?? [];
  const edges: Array<[number, number]> = [];
  const edgeIndex = new Map<number, number>();
  const edgeFaces: number[][] = [];
  const faceEdges: number[][] = [];
  const vertexFaces: number[][] = mesh.vertices.map(() => []);
  const vertexEdges: number[][] = mesh.vertices.map(() => []);
  faces.forEach((loop, faceIndex) => {
    const around: number[] = [];
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = edgeKey(a, b);
      let index = edgeIndex.get(key);
      if (index === undefined) {
        index = edges.length;
        edgeIndex.set(key, index);
        edges.push(a < b ? [a, b] : [b, a]);
        edgeFaces.push([]);
        vertexEdges[a]?.push(index);
        vertexEdges[b]?.push(index);
      }
      edgeFaces[index].push(faceIndex);
      around.push(index);
      vertexFaces[a]?.push(faceIndex);
    }
    faceEdges.push(around);
  });
  return { edges, edgeIndex, edgeFaces, faceEdges, vertexFaces, vertexEdges };
}

/** Unique polygon edges (never triangulation diagonals) — what the edit cage draws and selects. */
export function polyEdgePairs(mesh: Pick<ModelPartMesh, 'vertices' | 'faces'>): Array<[number, number]> {
  return buildTopology(mesh).edges;
}

// ------------------------------------------------------------------------------------------------
// Legacy triangles → polygons
// ------------------------------------------------------------------------------------------------

/**
 * Rebuild polygons from a bare triangle list (older saves, CSG results, imported GLBs): adjacent
 * coplanar triangles that share an edge and form a convex quad merge back into that quad. A box's
 * 12 triangles become its 6 quads again; a sphere's quad strips come back as quads, so edge loops
 * and loop cuts work on converted primitives.
 */
export function facesFromTriangles(vertices: readonly Vec3[], indices: readonly number[]): number[][] {
  const triangleCount = Math.floor(indices.length / 3);
  const tris: number[][] = [];
  for (let t = 0; t < triangleCount; t += 1) {
    const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    tris.push(tri);
  }
  const normals = tris.map((tri) => polygonNormal(vertices, tri));
  // Directed half-edge → triangle, so neighbours are found by the reversed edge.
  const halfEdges = new Map<string, number>();
  tris.forEach((tri, t) => {
    for (let i = 0; i < 3; i += 1) halfEdges.set(`${tri[i]}>${tri[(i + 1) % 3]}`, t);
  });
  const merged = new Array<boolean>(tris.length).fill(false);
  const faces: number[][] = [];
  const COPLANAR = 0.9995;
  for (let t = 0; t < tris.length; t += 1) {
    if (merged[t]) continue;
    const tri = tris[t];
    let best: { quad: number[]; other: number; score: number } | null = null;
    for (let i = 0; i < 3; i += 1) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      const c = tri[(i + 2) % 3];
      const other = halfEdges.get(`${b}>${a}`);
      if (other === undefined || other === t || merged[other]) continue;
      if (dot3(normals[t], normals[other]) < COPLANAR) continue;
      const otherTri = tris[other];
      const d = otherTri.find((vertex) => vertex !== a && vertex !== b);
      if (d === undefined) continue;
      // Quad a → d → b → c keeps the CCW winding of both triangles.
      const quad = [a, d, b, c];
      if (!isConvexLoop(vertices, quad, normals[t])) continue;
      // Prefer merging across the longest edge (the diagonal), which recovers grid quads.
      const score = length3(sub3(vertices[a], vertices[b]));
      if (!best || score > best.score) best = { quad, other, score };
    }
    if (best) {
      merged[t] = true;
      merged[best.other] = true;
      faces.push(best.quad);
    } else {
      merged[t] = true;
      faces.push(tri);
    }
  }
  return faces;
}

function isConvexLoop(vertices: readonly Vec3[], loop: readonly number[], normal: Vec3): boolean {
  for (let i = 0; i < loop.length; i += 1) {
    const a = vertices[loop[i]];
    const b = vertices[loop[(i + 1) % loop.length]];
    const c = vertices[loop[(i + 2) % loop.length]];
    if (dot3(cross3(sub3(b, a), sub3(c, b)), normal) <= 1e-9) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------
// Construction, normalization, cleanup
// ------------------------------------------------------------------------------------------------

const finiteVec = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component));

/**
 * Build a full mesh-part payload from vertices + polygon faces (+ optional per-face attributes),
 * deriving the triangulation. Every op in the mesh toolset returns through here.
 */
// Meshes this module built are valid by construction. Spec normalization runs on EVERY model edit,
// so it skips re-validating them — which also preserves object identity, the key every render-geometry
// cache uses (re-normalizing would re-subdivide every part of the model on each unrelated edit).
const trustedMeshes = new WeakSet<ModelPartMesh>();

/** True for meshes produced by makePolyMesh (and therefore already normalized). */
export const isTrustedPolyMesh = (mesh: unknown): mesh is ModelPartMesh =>
  !!mesh && typeof mesh === 'object' && trustedMeshes.has(mesh as ModelPartMesh);

export function makePolyMesh(
  vertices: Vec3[],
  faces: number[][],
  attributes: Pick<ModelPartMesh, 'faceSlots' | 'faceUVs' | 'sharpEdges'> = {},
): ModelPartMesh {
  const { indices } = triangulateFaces(vertices, faces);
  const mesh: ModelPartMesh = { vertices, indices, faces };
  if (attributes.faceSlots && attributes.faceSlots.some((slot) => slot >= 0)) mesh.faceSlots = attributes.faceSlots;
  if (attributes.faceUVs && attributes.faceUVs.length === faces.length) mesh.faceUVs = attributes.faceUVs;
  if (attributes.sharpEdges?.length) mesh.sharpEdges = attributes.sharpEdges;
  trustedMeshes.add(mesh);
  return mesh;
}

/** Faces of a mesh, rebuilding them from triangles for payloads that only carry `indices`. */
export function meshFaces(mesh: ModelPartMesh): number[][] {
  return mesh.faces ?? facesFromTriangles(mesh.vertices, mesh.indices);
}

/** A mesh guaranteed to carry `faces` (and a triangulation consistent with them). */
export function ensurePolyMesh(mesh: ModelPartMesh): ModelPartMesh {
  if (mesh.faces) return mesh;
  return makePolyMesh(mesh.vertices, facesFromTriangles(mesh.vertices, mesh.indices), {
    sharpEdges: mesh.sharpEdges,
  });
}

/**
 * Sanitize arbitrary mesh data (older saves, package payloads, AI output) into a renderable poly
 * mesh: finite unit-space vertices, in-range loops without repeated corners, attributes kept only
 * where they still line up, counts clamped so one bad part can never stall the editor. Faces are
 * rebuilt from `indices` for triangle-only payloads. Returns `null` when nothing usable remains.
 */
export function normalizePolyMesh(input: unknown): ModelPartMesh | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<Record<keyof ModelPartMesh, unknown>>;
  if (!Array.isArray(raw.vertices)) return null;
  const vertices: Vec3[] = [];
  const remap = new Map<number, number>();
  (raw.vertices as unknown[]).forEach((vertex, index) => {
    if (vertices.length >= MAX_MESH_VERTICES || !finiteVec(vertex)) return;
    remap.set(index, vertices.length);
    vertices.push(vertex.map((component) => Math.min(8, Math.max(-8, component))) as Vec3);
  });
  if (vertices.length < 3) return null;
  const mapIndex = (value: unknown): number | undefined => (Number.isInteger(value) ? remap.get(value as number) : undefined);
  let originalRemap = remap;

  let sourceFaces: unknown[] | null = Array.isArray(raw.faces) ? (raw.faces as unknown[]) : null;
  if (!sourceFaces) {
    if (!Array.isArray(raw.indices)) return null;
    const indices: number[] = [];
    for (const value of raw.indices as unknown[]) {
      const mapped = mapIndex(value);
      if (mapped === undefined) {
        // Drop the whole broken triangle so later triangles keep their alignment.
        indices.length -= indices.length % 3;
        continue;
      }
      indices.push(mapped);
    }
    indices.length -= indices.length % 3;
    sourceFaces = facesFromTriangles(vertices, indices);
    // Indices were already remapped; mark identity so the loop pass below keeps them.
    originalRemap = new Map(remap);
    remap.clear();
    vertices.forEach((_, index) => remap.set(index, index));
  }

  const faces: number[][] = [];
  const faceSlots: number[] = [];
  const faceUVs: Array<Array<[number, number]>> = [];
  const rawSlots = Array.isArray(raw.faceSlots) ? (raw.faceSlots as unknown[]) : null;
  const rawUVs = Array.isArray(raw.faceUVs) ? (raw.faceUVs as unknown[]) : null;
  let uvsUsable = !!rawUVs;
  sourceFaces.forEach((face, faceIndex) => {
    if (faces.length >= MAX_MESH_FACES || !Array.isArray(face)) return;
    const loop: number[] = [];
    const keptCorners: number[] = [];
    face.forEach((value, corner) => {
      const mapped = mapIndex(value);
      if (mapped === undefined) return;
      if (loop.length && loop[loop.length - 1] === mapped) return; // collapse repeated corners
      loop.push(mapped);
      keptCorners.push(corner);
    });
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) {
      loop.pop();
      keptCorners.pop();
    }
    if (loop.length < 3 || new Set(loop).size !== loop.length) return;
    faces.push(loop);
    const slot = rawSlots?.[faceIndex];
    faceSlots.push(Number.isInteger(slot) && (slot as number) >= 0 ? (slot as number) : -1);
    const uv = rawUVs?.[faceIndex];
    if (
      uvsUsable &&
      Array.isArray(uv) &&
      keptCorners.every((corner) => Array.isArray(uv[corner]) && uv[corner].length === 2 && uv[corner].every(Number.isFinite))
    ) {
      faceUVs.push(keptCorners.map((corner) => [uv[corner][0], uv[corner][1]] as [number, number]));
    } else {
      uvsUsable = false;
    }
  });
  if (!faces.length) return null;
  const sharpEdges = Array.isArray(raw.sharpEdges)
    ? (raw.sharpEdges as unknown[])
        .map((pair) => (Array.isArray(pair) ? [originalRemap.get(pair[0]), originalRemap.get(pair[1])] : []))
        .filter((pair): pair is [number, number] => pair.length === 2 && pair[0] !== undefined && pair[1] !== undefined && pair[0] !== pair[1])
    : undefined;
  return makePolyMesh(vertices, faces, {
    faceSlots,
    faceUVs: uvsUsable ? faceUVs : undefined,
    sharpEdges,
  });
}

/**
 * Remove vertices no face uses and renumber everything (faces, sharp edges). Ops that delete or
 * merge geometry finish with this so the stored payload never accumulates dead vertices.
 */
export function compactMesh(mesh: ModelPartMesh): ModelPartMesh {
  const faces = meshFaces(mesh);
  const used = new Map<number, number>();
  const vertices: Vec3[] = [];
  for (const loop of faces) {
    for (const index of loop) {
      if (!used.has(index)) {
        used.set(index, vertices.length);
        vertices.push(mesh.vertices[index]);
      }
    }
  }
  const remapped = faces.map((loop) => loop.map((index) => used.get(index)!));
  const sharpEdges = mesh.sharpEdges
    ?.filter(([a, b]) => used.has(a) && used.has(b))
    .map(([a, b]) => [used.get(a)!, used.get(b)!] as [number, number]);
  return makePolyMesh(vertices, remapped, { faceSlots: mesh.faceSlots, faceUVs: mesh.faceUVs, sharpEdges });
}

/**
 * Merge vertices closer than `distance` (Blender's "Merge by Distance"). Faces that collapse below
 * three distinct corners are removed; per-face attributes follow their surviving faces.
 */
export function weldMesh(mesh: ModelPartMesh, distance = 1e-4): ModelPartMesh {
  const faces = meshFaces(mesh);
  const cell = Math.max(distance, 1e-9);
  const grid = new Map<string, number[]>();
  const target = new Array<number>(mesh.vertices.length);
  mesh.vertices.forEach((vertex, index) => {
    const cx = Math.floor(vertex[0] / cell);
    const cy = Math.floor(vertex[1] / cell);
    const cz = Math.floor(vertex[2] / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx += 1) {
      for (let dy = -1; dy <= 1 && found < 0; dy += 1) {
        for (let dz = -1; dz <= 1 && found < 0; dz += 1) {
          for (const candidate of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (length3(sub3(mesh.vertices[candidate], vertex)) <= distance) {
              found = candidate;
              break;
            }
          }
        }
      }
    }
    if (found >= 0) {
      target[index] = found;
    } else {
      target[index] = index;
      const key = `${cx},${cy},${cz}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  });
  const nextFaces: number[][] = [];
  const faceSlots: number[] = [];
  const faceUVs: Array<Array<[number, number]>> = [];
  faces.forEach((loop, faceIndex) => {
    const welded: number[] = [];
    const corners: number[] = [];
    loop.forEach((index, corner) => {
      const mapped = target[index];
      if (welded.length && welded[welded.length - 1] === mapped) return;
      welded.push(mapped);
      corners.push(corner);
    });
    if (welded.length > 1 && welded[0] === welded[welded.length - 1]) {
      welded.pop();
      corners.pop();
    }
    if (welded.length < 3 || new Set(welded).size !== welded.length) return;
    nextFaces.push(welded);
    faceSlots.push(mesh.faceSlots?.[faceIndex] ?? -1);
    const uv = mesh.faceUVs?.[faceIndex];
    if (uv) faceUVs.push(corners.map((corner) => uv[corner]));
  });
  const sharpEdges = mesh.sharpEdges
    ?.map(([a, b]) => [target[a], target[b]] as [number, number])
    .filter(([a, b]) => a !== b);
  return compactMesh(
    makePolyMesh(mesh.vertices, nextFaces, {
      faceSlots,
      faceUVs: mesh.faceUVs && faceUVs.length === nextFaces.length ? faceUVs : undefined,
      sharpEdges,
    }),
  );
}

/** A unit cube as six quads — the canonical starting mesh. */
export const UNIT_CUBE_POLY: ModelPartMesh = makePolyMesh(
  [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ],
  [
    [1, 0, 3, 2], // -Z
    [4, 5, 6, 7], // +Z
    [1, 2, 6, 5], // +X
    [0, 4, 7, 3], // -X
    [3, 7, 6, 2], // +Y
    [0, 1, 5, 4], // -Y
  ],
);

/** Deep copy (vertices, faces and every per-face attribute). */
export function clonePolyMesh(mesh: ModelPartMesh): ModelPartMesh {
  return {
    vertices: mesh.vertices.map((vertex) => [...vertex] as Vec3),
    indices: [...mesh.indices],
    ...(mesh.faces ? { faces: mesh.faces.map((loop) => [...loop]) } : {}),
    ...(mesh.faceSlots ? { faceSlots: [...mesh.faceSlots] } : {}),
    ...(mesh.faceUVs ? { faceUVs: mesh.faceUVs.map((uvs) => uvs.map((uv) => [...uv] as [number, number])) } : {}),
    ...(mesh.sharpEdges ? { sharpEdges: mesh.sharpEdges.map((edge) => [...edge] as [number, number]) } : {}),
  };
}
